// PLAYWRIGHT_MODULE=/path/to/playwright node tests/animated-webp.browser.cjs [video.mp4] [animation.gif]
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const esbuild = require('esbuild');
(async () => {
    const bundle = await esbuild.build({
        stdin: { contents: `export * from './src/motionCardExporter'; export * from './src/animatedWebp'; export * from './src/motionFrameRenderer'; export {DownloadManager} from './src/downloadManager'; export {default as JSZip} from 'jszip'; export * as htmlToImage from 'html-to-image';`, resolveDir: path.resolve(__dirname, '..') },
        bundle: true, write: false, format: 'iife', globalName: 'api', loader: { '.swift': 'text' }, external: ['path', 'fs', 'os', 'crypto', 'child_process', 'electron'],
        plugins: [{ name: 'obsidian', setup(build) {
            build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'mock' }));
            build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export class Notice {} export async function requestUrl({url}) { return {arrayBuffer: await (await fetch(url)).arrayBuffer()}; }' }));
            if(process.env.BASELINE_RENDERER==='1') build.onLoad({filter:/motionFrameRenderer\.ts$/},()=>({contents:`
                import * as htmlToImage from 'html-to-image';
                import {withInlinedRemoteResources} from './exportResourceInliner';
                import {shouldExportNode} from './exportVisibility';
                export async function createMotionFrameRenderer(root,media,width,height) {
                    const fontEmbedCSS=await htmlToImage.getFontEmbedCSS(root);
                    return ()=>withInlinedRemoteResources(root,()=>htmlToImage.toCanvas(root,{canvasWidth:width,canvasHeight:height,pixelRatio:1,fontEmbedCSS,filter:shouldExportNode}));
                }`,loader:'ts'}));
        } }]
    });
    const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    try {
        const page = await browser.newPage();
        page.on('console', message => console.log('[browser]', message.text()));
        await page.route('http://localhost:19387/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
        await page.goto('http://localhost:19387/'); // ImageDecoder requires a secure context.
        await page.evaluate(() => { window.require = name => { if (name === 'path') return {}; throw Error('Unexpected native dependency: ' + name); }; });
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        const video = process.argv[2] ? 'data:video/mp4;base64,' + fs.readFileSync(process.argv[2]).toString('base64') : '';
        const gif = process.argv[3] ? 'data:image/gif;base64,' + fs.readFileSync(process.argv[3]).toString('base64') : '';
        const result = await page.evaluate(async ({video, gif, refresh}) => {
            const check = (ok, message) => { if (!ok) throw Error(message); };
            check(JSON.stringify(api.webpDimensions(540,720)) === '{"width":720,"height":960}', 'portrait dimensions');
            check(JSON.stringify(api.webpDimensions(500,500)) === '{"width":800,"height":800}', 'square dimensions');
            const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
            const frames = [];
            for (const color of ['red','blue']) {
                const ctx = canvas.getContext('2d'); ctx.fillStyle=color; ctx.fillRect(0,0,32,32);
                frames.push(await api.encodeWebpFrame(canvas));
            }
            const packed = api.packAnimatedWebp(frames,32,32);
            const decoder = new ImageDecoder({data:packed,type:'image/webp'});
            await decoder.tracks.ready;
            check(decoder.tracks.selectedTrack.frameCount === 2, 'mux frame count');
            for (let i=0;i<2;i++) {
                const {image} = await decoder.decode({frameIndex:i});
                check(image.duration === 2500000, 'mux duration');
                canvas.getContext('2d').drawImage(image,0,0);
                const pixel=canvas.getContext('2d').getImageData(0,0,1,1).data;
                check(i===0 ? pixel[0]>200 && pixel[2]<30 : pixel[2]>200 && pixel[0]<30, 'frame content');
                image.close();
            }
            decoder.close();
            const many = Array.from({length:75},(_,i)=>frames[i%2]);
            const cap = api.packAnimatedWebp(many.filter((_,i)=>i%2===0),32,32).length;
            const limited = api.fitAnimatedWebp(many,32,32,cap);
            check(limited.length<=cap,'size budget');
            let rejected=false; try {api.fitAnimatedWebp(many,32,32,1);} catch {rejected=true;}
            check(rejected,'over-budget failure');
            rejected=false; try {api.packAnimatedWebp([new Uint8Array(20)],32,32);} catch {rejected=true;}
            check(rejected,'invalid frame failure');
            // Compare dirty-region redraw to full-page rendering, including rounded corners and borders.
            const swatches=[];
            for(const color of ['#dd2200','#2244dd']) {canvas.getContext('2d').fillStyle=color;canvas.getContext('2d').fillRect(0,0,32,32);swatches.push(canvas.toDataURL());}
            document.body.innerHTML='<article id="layout" style="width:300px;height:400px;background:#fff5e8;color:#111;font:20px Arial;padding:12px;box-sizing:border-box"><p>Static title 库森</p><img style="width:210px;height:120px;border:3px solid orange;border-radius:24px;box-shadow:0 4px 8px #555;object-fit:cover"><p>Footer stays fixed</p></article>';
            const layout=document.querySelector('#layout'), media=layout.querySelector('img');media.src=swatches[0];await media.decode();
            const render=await api.createMotionFrameRenderer(layout,[media],600,800);
            for(const src of swatches) {
                media.src=src;await media.decode();const optimized=await render();
                const reference=await api.htmlToImage.toCanvas(layout,{canvasWidth:600,canvasHeight:800,pixelRatio:1});
                const a=optimized.getContext('2d').getImageData(0,0,600,800).data,b=reference.getContext('2d').getImageData(0,0,600,800).data;
                let error=0;for(let i=0;i<a.length;i++)error+=Math.abs(a[i]-b[i]);
                check(error/a.length<2,'dirty region must match full render: '+error/a.length);
            }
            console.log('Rounded media/border/shadow composition matches full render');
            if (!video) return {unit:true};
            document.body.innerHTML = `<div><article id="card" style="width:540px;height:720px;background:#fff5e8;color:#111;font:28px Arial"><h1>WebP / 库森</h1><p>正文不动，视频动</p><video width="500" height="300" muted></video><section style="display:none"><video src="invalid.mp4"></video></section></article></div>`;
            const card=document.querySelector('#card'); card.querySelector('video').src=video;
            if(gif) {const img=document.createElement('img');img.src=gif;img.width=100;img.height=100;card.appendChild(img);await img.decode();}
            const before=card.outerHTML;
            const started=performance.now();
            const resources=await api.DownloadManager.createResources(card,'webp',text=>{
                if(/15\/|30\/|45\/|60\/|75\//.test(text)) console.log(text);
                if(refresh && text==='渲染 42/75') card.parentElement.replaceChildren();
            });
            console.log('Export milliseconds',Math.round(performance.now()-started));
            check(resources.length===1 && resources[0].name==='card.webp','dynamic routing');
            check(card.outerHTML===before && document.querySelectorAll('article').length===(refresh?0:1),'preview restoration');
            check(document.querySelectorAll('[data-note2card-export]').length===0,'snapshot cleanup');
            const bytes=new Uint8Array(await resources[0].blob.arrayBuffer());
            const motion=new ImageDecoder({data:bytes,type:'image/webp'});await motion.tracks.ready;
            const count=motion.tracks.selectedTrack.frameCount;
            check([75,38,25].includes(count),'production frame count');
            let duration=0;let firstPixels,lastPixels;
            for(let i=0;i<count;i++) {
                const {image}=await motion.decode({frameIndex:i});
                check(image.displayWidth===720 && image.displayHeight===960,'production dimensions');
                duration+=image.duration;
                {
                    canvas.width=720;canvas.height=960;canvas.getContext('2d').drawImage(image,0,0);
                    const pixels=canvas.getContext('2d').getImageData(0,0,720,960).data;
                    let dark=0;for(let k=0;k<pixels.length;k+=4)if(Math.min(pixels[k],pixels[k+1],pixels[k+2])<180)dark++;
                    check(dark>1000,`frame ${i} must not be blank`);
                    if(i===0) firstPixels=pixels;
                    if(i===count-1) lastPixels=pixels;
                    // Lossy WebP can vary quantization slightly; reject missing/shifted static text.
                    let headerError=0;for(let k=0;k<720*80*4;k++)headerError+=Math.abs(pixels[k]-firstPixels[k]);
                    check(headerError/(720*80*4)<2,`static header changed at ${i}`);
                }
                image.close();
            }
            check(duration===5000000,'five seconds');
            check(firstPixels.some((v,i)=>v!==lastPixels[i]),'animation actually changes');
            motion.close();
            if(refresh) document.body.appendChild(card);
            card.querySelectorAll('video,img').forEach(el=>el.remove());
            const still=await api.DownloadManager.createResources(card,'webp',()=>{});
            console.log('Single page decode and static routing passed');
            check(still.length===1 && still[0].name==='card.png' && still[0].blob.type==='image/png','static routing');
            document.body.innerHTML='<div id="wrapper"><article class="red-image-preview"><div class="red-preview-container"><section class="red-content-section red-section-active" style="display:block">Static</section><section class="red-content-section" style="display:none">Motion</section></div><span class="red-page-number">1 / 2</span></article></div>';
            const wrapper=document.querySelector('#wrapper');
            const previewState=()=>JSON.stringify({pages:Array.from(wrapper.querySelectorAll('section'),el=>[el.className,el.style.display]),number:wrapper.querySelector('.red-page-number').textContent});
            const original=previewState();
            // Reuse the already verified render results; exercise actual batch visibility, naming and ZIP saving.
            api.DownloadManager.createResources=async (root,format)=>{
                check(format==='webp','batch format');
                return root.querySelector('.red-section-active').textContent==='Static' ? still : resources;
            };
            api.DownloadManager.saveBlob=async (blob,name,extension)=>{
                console.log('ZIP generated', blob.size);
                check(extension==='zip' && name.endsWith('.zip'),'batch save');
                const zip=await api.JSZip.loadAsync(await blob.arrayBuffer());
                check(zip.file('小红书笔记_第01页.png') && zip.file('小红书笔记_第02页.webp') && zip.file('动态WebP使用说明.txt'),'mixed ZIP order');
                check((await zip.file('小红书笔记_第02页.webp').async('uint8array')).length===bytes.length,'ZIP preserves animation');
                return true;
            };
            check(await api.DownloadManager.downloadAllImages(wrapper,{format:'webp'}),'batch success');
            check(original===previewState(),'batch preview restoration');
            return {unit:true,frames:count,duration,bytes:Array.from(bytes)};
        }, { video, gif, refresh: process.env.REFRESH_DURING_EXPORT === '1' });
        if(result.bytes) {
            const output=path.join(require('os').tmpdir(),'note2card-webp-test.webp');
            fs.writeFileSync(output,Buffer.from(result.bytes));
            console.log(`PASS: actual GIF/video → ${result.frames} frames / ${result.duration/1e6}s, ${result.bytes.length} bytes, ${output}`);
        }
        assert(result.unit);
        console.log('PASS: WebP decoding, frame colors, size limit/downsampling, invalid input, dimensions; no native encoder needed');
    } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
