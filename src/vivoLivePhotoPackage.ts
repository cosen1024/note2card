import JSZip from 'jszip';
import type { CardResource } from './motionCardExporter';

export const vivoLivePhotoInstructions = '每个动态页是一对同名的 JPG 和 MP4，两个文件必须在一起才是实况照片。静态页为 PNG。\n\n导入步骤：\n1. 把这个 ZIP 传到手机。用 USB 或网盘，不要用聊天软件按图片发送。\n2. 在手机文件管理中解压。\n3. 把全部文件一起复制到 DCIM/Camera。不要改名，不要只复制 JPG。\n4. 打开相册，确认动态页有实况标识。没有时关闭相册后重新打开。\n5. 在小红书选图发布。\n\n实况长度为 5 秒，无声。vivo 相册预览只播放约 3 秒，这是相册的限制；发布到小红书后播放完整的 5 秒。\n已在 vivo X200 上实测相册和小红书选图可识别；其他机型和系统版本未验证。';

/** 选中 vivo 格式时弹出的提醒。 */
export const vivoLivePhotoNotice = 'vivo 实况照片：仅适配 vivo / iQOO 手机（已在 vivo X200 实测）。\n· 长度 5 秒，无声；相册预览只播约 3 秒，小红书里播放完整 5 秒\n· 每个动态页是一对同名 JPG + MP4，必须一起传到手机\n· 解压后整体复制到 DCIM/Camera，不要改名\n· 用 USB 或网盘传输，不要用聊天软件按图片发送\n其他品牌手机请选“安卓动态照片”或“动态 MP4”。';

const pad = (value: number) => String(value).padStart(2, '0');

/** 同一次导出共用的文件名前缀，例如 IMG_20261110_203000。 */
export function vivoBaseName(date: Date = new Date()): string {
    return `IMG_${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export const isVivoPair = (resources: CardResource[]) => resources.some(resource => resource.name === 'card.jpg') && resources.some(resource => resource.name === 'card.mp4');

export async function addVivoLivePhoto(zip: JSZip, name: string, resources: CardResource[]): Promise<void> {
    const photo = resources.find(resource => resource.name === 'card.jpg');
    const video = resources.find(resource => resource.name === 'card.mp4');
    if (!photo || !video) throw new Error('vivo 实况缺少配对照片或视频');
    zip.file(`${name}.jpg`, await photo.blob.arrayBuffer());
    zip.file(`${name}.mp4`, await video.blob.arrayBuffer());
}
