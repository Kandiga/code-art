import {chromium} from 'playwright-core';
const W=+process.argv[2]||1920, SUB=+process.argv[3]||1, N=+process.argv[4]||6;
const exe='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b=await chromium.launch({executablePath:exe,headless:true,args:['--headless=new','--ignore-gpu-blocklist','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--no-sandbox','--disable-dev-shm-usage']});
const p=await b.newPage({viewport:{width:W,height:Math.round(W*9/16)}});
p.on('console',m=>console.log('[page]',m.text())); p.on('pageerror',e=>console.log('[err]',e.message));
await p.goto('http://localhost:8123/web/bench.html?w='+W); await p.waitForFunction('window.ready===true',null,{timeout:60000});
await p.evaluate(()=>window.bench(1,1)); // warm-up (shader compile)
const r=await p.evaluate(([n,s])=>window.bench(n,s),[N,SUB]); console.log(JSON.stringify(r)); await b.close();
