/** JPEG + XMP directory + appended MP4, per Android Motion Photo 1.0.
 * https://developer.android.com/media/platform/motion-photo-format
 * Legacy MicroVideo fields aid readers predating the container directory.
 */
export function packAndroidMotionPhoto(jpeg: Uint8Array, mp4: Uint8Array, timestampUs: number): Uint8Array {
    if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[jpeg.length - 2] !== 0xff || jpeg[jpeg.length - 1] !== 0xd9) {
        throw new Error('动态照片封面不是完整 JPEG');
    }
    if (mp4.length < 12 || String.fromCharCode(...mp4.slice(4, 8)) !== 'ftyp') throw new Error('动态照片缺少有效 MP4');
    if (!Number.isSafeInteger(timestampUs) || timestampUs < 0) throw new Error('动态照片封面时间无效');
    const xml = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:Camera="http://ns.google.com/photos/1.0/camera/" xmlns:Container="http://ns.google.com/photos/1.0/container/" xmlns:Item="http://ns.google.com/photos/1.0/container/item/" Camera:MotionPhoto="1" Camera:MotionPhotoVersion="1" Camera:MotionPhotoPresentationTimestampUs="${timestampUs}" Camera:MicroVideo="1" Camera:MicroVideoVersion="1" Camera:MicroVideoOffset="${mp4.length}" Camera:MicroVideoPresentationTimestampUs="${timestampUs}"><Container:Directory><rdf:Seq><rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="image/jpeg" Item:Semantic="Primary" Item:Length="0" Item:Padding="0"/></rdf:li><rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="video/mp4" Item:Semantic="MotionPhoto" Item:Length="${mp4.length}"/></rdf:li></rdf:Seq></Container:Directory></rdf:Description></rdf:RDF></x:xmpmeta>`;
    const payload = new TextEncoder().encode('http://ns.adobe.com/xap/1.0/\0' + xml);
    const length = payload.length + 2;
    if (length > 65535) throw new Error('动态照片元数据过大');
    // Retain a leading JFIF APP0 segment, if present.
    let offset = 2;
    if (jpeg[2] === 0xff && jpeg[3] === 0xe0) {
        offset = 4 + (jpeg[4] * 256 + jpeg[5]);
        if (offset >= jpeg.length - 2) throw new Error('JPEG 头部长度无效');
    }
    const segment = new Uint8Array(payload.length + 4);
    segment.set([0xff, 0xe1, length >> 8, length & 255]);
    segment.set(payload, 4);
    const result = new Uint8Array(jpeg.length + segment.length + mp4.length);
    result.set(jpeg.subarray(0, offset));
    result.set(segment, offset);
    result.set(jpeg.subarray(offset), offset + segment.length);
    result.set(mp4, jpeg.length + segment.length);
    return result;
}
