import { Notice } from 'obsidian';
import type { CardResource } from './motionCardExporter';
import source from './photosImport.swift';

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>cn.kusen.note2card.photos</string>
<key>CFBundleName</key><string>Note to Card Photos</string>
<key>CFBundleExecutable</key><string>NoteToCardPhotos</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>
<key>NSPhotoLibraryAddUsageDescription</key><string>将你导出的卡片保存为照片或实况照片，方便同步到手机发布。</string>
<key>NSPhotoLibraryUsageDescription</key><string>将你导出的卡片保存到照片图库。</string>
</dict></plist>`;

function run(file: string, args: string[], timeout = 240_000): Promise<void> {
    return new Promise((resolve, reject) => require('child_process').execFile(file, args, { timeout }, (error: Error | null, stdout: string, stderr: string) => {
        error ? reject(new Error(stderr || error.message)) : resolve();
    }));
}

let helperPromise: Promise<string> | undefined;
async function prepareHelper(): Promise<string> {
    if (!helperPromise) helperPromise = (async () => {
        if (process.platform !== 'darwin') throw new Error('存入照片目前支持 Mac 桌面版');
        const fs = require('fs').promises;
        const path = require('path');
        // Reuse the same signed app across plugin reloads so its permission identity stays stable.
        const version = require('crypto').createHash('sha256').update(source + plist).digest('hex').slice(0, 16);
        const directory = path.join(require('os').tmpdir(), `note2card-photos-helper-${version}`);
        const app = path.join(directory, 'Note to Card Photos.app');
        try {
            await fs.access(path.join(app, 'Contents', 'MacOS', 'NoteToCardPhotos'));
            await run('/usr/bin/codesign', ['--verify', app]);
            return app;
        } catch { /* Build a missing or invalid helper. */ }
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        try {
            await fs.mkdir(path.join(app, 'Contents', 'MacOS'), { recursive: true });
            await fs.writeFile(path.join(app, 'Contents', 'Info.plist'), plist);
            const swift = path.join(directory, 'import.swift');
            await fs.writeFile(swift, source);
            await run('/usr/bin/xcrun', ['swiftc', '-module-cache-path', path.join(directory, 'cache'), swift, '-o', path.join(app, 'Contents', 'MacOS', 'NoteToCardPhotos')]);
            await run('/usr/bin/codesign', ['--force', '--sign', '-', app]);
            await fs.rm(path.join(directory, 'cache'), { recursive: true, force: true });
            await fs.unlink(swift);
            return app;
        } catch (error) {
            await fs.rm(directory, { recursive: true, force: true });
            throw error;
        }
    })().catch(error => { helperPromise = undefined; throw error; });
    return helperPromise;
}

/** One item per page; photo and pairedVideo are created as ONE Photos asset. */
export async function saveCardsToPhotos(pages: CardResource[][], progress: (text: string) => void): Promise<void> {
    progress('准备存入照片…');
    const app = await prepareHelper();
    const fs = require('fs').promises;
    const path = require('path');
    const directory = await fs.mkdtemp(path.join(require('os').tmpdir(), 'note2card-photos-job-'));
    let launched = false;
    let completed = false;
    try {
        const items: Array<{ photo: string; video?: string }> = [];
        for (let index = 0; index < pages.length; index++) {
            let photo: string | undefined;
            let video: string | undefined;
            for (const resource of pages[index]) {
                const extension = resource.name.split('.').pop()!;
                if (!['jpg', 'png', 'mov'].includes(extension)) throw new Error('照片导入格式不支持');
                const target = path.join(directory, `card-${String(index + 1).padStart(3, '0')}.${extension}`);
                await fs.writeFile(target, Buffer.from(await resource.blob.arrayBuffer()));
                if (extension === 'mov') video = target; else photo = target;
            }
            if (!photo) throw new Error('缺少卡片封面');
            items.push({ photo, video });
        }
        await fs.writeFile(path.join(directory, 'job.json'), JSON.stringify({ items }));
        progress('正在存入照片；如出现系统提示，请允许添加照片');
        await run('/usr/bin/open', ['-n', app, '--args', '--job', directory]);
        launched = true;
        const deadline = Date.now() + 300_000;
        while (Date.now() < deadline) {
            let result: { success: boolean; message: string } | undefined;
            try { result = JSON.parse(await fs.readFile(path.join(directory, 'result.json'), 'utf8')); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
            if (result) {
                completed = true;
                if (!result.success) throw new Error(result.message);
                progress(result.message);
                new Notice(`${result.message}。可在「照片」的最近项目中查看。`, 8000);
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        // Do not destroy resources while a permission prompt/import may still be pending.
        throw new Error('等待照片保存结果超时，请先检查系统权限提示和「照片」最近项目，避免重复导入');
    } finally {
        if (!launched || completed) await fs.rm(directory, { recursive: true, force: true });
    }
}
