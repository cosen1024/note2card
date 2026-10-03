import JSZip from 'jszip';
import type { CardResource } from './motionCardExporter';

// Directory-package layout used by LiveCanvas/makelive, not a new video format.
const metadata = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>PFVideoComplementMetadataVersionKey</key><string>1</string></dict></plist>`;

export const livePackageInstructions = '解压后得到 .pvt 实况资源包（Mac 上显示为一个项目），内部已配对，无需手动组合 JPG/MOV。\n这不是 MP4 改后缀，ZIP 只是传输容器。接收应用必须支持 Apple 实况资源；不保证 iPhone 文件 App、vivo 或小红书直接识别 .pvt。\n需要存入 Mac 照片时，请改选“实况 → 照片（Mac）”。本模式不会访问照片库。\n静态页仍为 PNG。手机播放及社交平台上传需另行验证。';

export async function addLivePackage(zip: JSZip, name: string, resources: CardResource[]): Promise<void> {
    const photo = resources.find(resource => resource.name === 'card.jpg');
    const video = resources.find(resource => resource.name === 'card.mov');
    if (!photo || !video) throw new Error('实况资源缺少配对照片或视频');
    const folder = zip.folder(`${name}.pvt`)!;
    // Explicit bytes also avoid browser/Node Blob differences in ZIP readers.
    folder.file(`${name}.jpg`, await photo.blob.arrayBuffer());
    folder.file(`${name}.mov`, await video.blob.arrayBuffer());
    folder.file('metadata.plist', metadata);
}
