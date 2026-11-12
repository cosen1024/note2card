import Foundation
import AVFoundation
import ImageIO
import UniformTypeIdentifiers
import Photos
import AppKit

// Input: numbered PNG frames, frame count, fps, output mode (mp4/live).
// Optional for mp4: an audio source file and its loop length in seconds.
// All resources are generated locally; this helper never accesses the photo library.
func export(_ session: AVAssetExportSession?, to url: URL, type: AVFileType) throws {
    guard let session = session else { throw NSError(domain: "Audio export session", code: 12) }
    session.outputURL = url
    session.outputFileType = type
    let done = DispatchSemaphore(value: 0)
    session.exportAsynchronously { done.signal() }
    guard done.wait(timeout: .now() + 120) == .success, session.status == .completed else {
        throw session.error ?? NSError(domain: "Audio export", code: 13)
    }
}

// Mux the source's first audio track into card.mp4. Frames show the source at
// (time % loopSeconds), so the audio repeats with the same period. The video is not re-encoded.
func addAudio(directory: URL, source: URL, loopSeconds: Double) throws {
    let videoURL = directory.appendingPathComponent("card.mp4")
    let video = AVURLAsset(url: videoURL)
    guard let videoTrack = video.tracks(withMediaType: .video).first else { throw NSError(domain: "Encoded video track", code: 14) }
    // A source without a readable audio track simply yields a silent clip.
    let sourceAsset = AVURLAsset(url: source)  // keep the asset alive while its track is in use
    guard let sourceTrack = sourceAsset.tracks(withMediaType: .audio).first else { return }
    let total = video.duration
    let period = CMTime(seconds: loopSeconds, preferredTimescale: 44100)
    let looped = AVMutableComposition()
    guard let loopTrack = looped.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw NSError(domain: "Audio track", code: 15) }
    var at = CMTime.zero
    while at < total {
        let length = CMTimeMinimum(CMTimeMinimum(sourceTrack.timeRange.duration, period), total - at)
        try loopTrack.insertTimeRange(CMTimeRange(start: sourceTrack.timeRange.start, duration: length), of: sourceTrack, at: at)
        if length < period { loopTrack.insertEmptyTimeRange(CMTimeRange(start: at + length, duration: period - length)) }
        at = at + period
    }
    let audioURL = directory.appendingPathComponent("audio.m4a")
    try export(AVAssetExportSession(asset: looped, presetName: AVAssetExportPresetAppleM4A), to: audioURL, type: .m4a)
    let encodedAsset = AVURLAsset(url: audioURL)
    guard let encoded = encodedAsset.tracks(withMediaType: .audio).first else { throw NSError(domain: "Encoded audio track", code: 16) }
    let combined = AVMutableComposition()
    guard let outVideo = combined.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
          let outAudio = combined.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw NSError(domain: "Output tracks", code: 17) }
    try outVideo.insertTimeRange(CMTimeRange(start: .zero, duration: total), of: videoTrack, at: .zero)
    try outAudio.insertTimeRange(CMTimeRange(start: .zero, duration: CMTimeMinimum(total, encoded.timeRange.duration)), of: encoded, at: .zero)
    let outputURL = directory.appendingPathComponent("card-audio.mp4")
    try export(AVAssetExportSession(asset: combined, presetName: AVAssetExportPresetPassthrough), to: outputURL, type: .mp4)
    try FileManager.default.removeItem(at: videoURL)
    try FileManager.default.moveItem(at: outputURL, to: videoURL)
}

func run() throws {
    let args = CommandLine.arguments
    guard args.count == 5 || args.count == 7, let count = Int(args[2]), let fps = Int32(args[3]), count > 0, fps > 0 else {
        throw NSError(domain: "Arguments", code: 1)
    }
    let directory = URL(fileURLWithPath: args[1])
    let live = args[4] == "live"
    let identifier = UUID().uuidString
    func frame(_ index: Int) throws -> CGImage {
        let url = directory.appendingPathComponent(String(format: "%04d.png", index))
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            throw NSError(domain: "Cannot read frame \(index)", code: 2)
        }
        return image
    }
    let first = try frame(0)
    let width = first.width, height = first.height
    let writer = try AVAssetWriter(outputURL: directory.appendingPathComponent(live ? "card.mov" : "card.mp4"), fileType: live ? .mov : .mp4)
    let videoSettings: [String: Any] = [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: width, AVVideoHeightKey: height,
        AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 6_000_000]
    ]
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
    let pixelAttributes: [String: Any] = [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
        kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height,
        kCVPixelBufferCGImageCompatibilityKey as String: true,
        kCVPixelBufferCGBitmapContextCompatibilityKey as String: true
    ]
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: pixelAttributes)
    writer.add(input)
    var metadataAdaptor: AVAssetWriterInputMetadataAdaptor?
    if live {
        let id = AVMutableMetadataItem()
        id.keySpace = .quickTimeMetadata
        id.key = "com.apple.quicktime.content.identifier" as NSString
        id.value = identifier as NSString
        writer.metadata = [id]
        var description: CMFormatDescription?
        let specification: [String: Any] = [
            kCMMetadataFormatDescriptionMetadataSpecificationKey_Identifier as String: "mdta/com.apple.quicktime.still-image-time",
            kCMMetadataFormatDescriptionMetadataSpecificationKey_DataType as String: "com.apple.metadata.datatype.int8"
        ]
        let status = CMMetadataFormatDescriptionCreateWithMetadataSpecifications(allocator: kCFAllocatorDefault, metadataType: kCMMetadataFormatType_Boxed, metadataSpecifications: [specification] as CFArray, formatDescriptionOut: &description)
        guard status == noErr else { throw NSError(domain: "Metadata description", code: Int(status)) }
        let metadataInput = AVAssetWriterInput(mediaType: .metadata, outputSettings: nil, sourceFormatHint: description)
        writer.add(metadataInput)
        metadataAdaptor = AVAssetWriterInputMetadataAdaptor(assetWriterInput: metadataInput)
    }
    guard writer.startWriting() else { throw writer.error! }
    writer.startSession(atSourceTime: .zero)
    if let metadata = metadataAdaptor {
        let item = AVMutableMetadataItem()
        item.keySpace = .quickTimeMetadata
        item.key = "com.apple.quicktime.still-image-time" as NSString
        item.value = NSNumber(value: Int8(0))
        item.dataType = "com.apple.metadata.datatype.int8"
        guard metadata.append(AVTimedMetadataGroup(items: [item], timeRange: CMTimeRange(start: CMTime(value: Int64(count / 2), timescale: fps), duration: CMTime(value: 1, timescale: fps)))) else { throw writer.error! }
        metadata.assetWriterInput.markAsFinished()
    }
    for index in 0..<count {
        try autoreleasepool {
            let deadline = Date().addingTimeInterval(30)
            while !input.isReadyForMoreMediaData {
                if writer.status == .failed { throw writer.error! }
                if Date() > deadline { throw NSError(domain: "Encoder timeout", code: 3) }
                Thread.sleep(forTimeInterval: 0.002)
            }
            var buffer: CVPixelBuffer?
            guard let pool = adaptor.pixelBufferPool,
                  CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess,
                  let pixels = buffer else { throw NSError(domain: "Pixel buffer", code: 4) }
            CVPixelBufferLockBaseAddress(pixels, [])
            defer { CVPixelBufferUnlockBaseAddress(pixels, []) }
            guard let context = CGContext(data: CVPixelBufferGetBaseAddress(pixels), width: width, height: height, bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(pixels), space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue) else { throw NSError(domain: "Frame context", code: 5) }
            let bounds = CGRect(x: 0, y: 0, width: width, height: height)
            context.setFillColor(CGColor(gray: 1, alpha: 1))
            context.fill(bounds)
            context.draw(try frame(index), in: bounds)
            guard adaptor.append(pixels, withPresentationTime: CMTime(value: Int64(index), timescale: fps)) else { throw writer.error! }
        }
    }
    input.markAsFinished()
    writer.endSession(atSourceTime: CMTime(value: Int64(count), timescale: fps))
    let finished = DispatchSemaphore(value: 0)
    writer.finishWriting { finished.signal() }
    guard finished.wait(timeout: .now() + 60) == .success, writer.status == .completed else {
        throw writer.error ?? NSError(domain: "Finish encoding", code: 6)
    }
    if !live, args.count == 7 {
        guard let loopSeconds = Double(args[6]), loopSeconds > 0 else { throw NSError(domain: "Arguments", code: 1) }
        try addAudio(directory: directory, source: URL(fileURLWithPath: args[5]), loopSeconds: loopSeconds)
    }
    if live {
        let url = directory.appendingPathComponent("card.jpg")
        guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { throw NSError(domain: "JPEG destination", code: 7) }
        let properties: [String: Any] = [kCGImagePropertyMakerAppleDictionary as String: ["17": identifier], kCGImageDestinationLossyCompressionQuality as String: 0.95]
        CGImageDestinationAddImage(destination, try frame(count / 2), properties as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw NSError(domain: "JPEG write", code: 8) }

        // Verify the actual files, not only that the encoder returned successfully.
        let videoURL = directory.appendingPathComponent("card.mov")
        let asset = AVURLAsset(url: videoURL)
        let checkSource = CGImageSourceCreateWithURL(url as CFURL, nil)!
        let readProperties = CGImageSourceCopyPropertiesAtIndex(checkSource, 0, nil) as? [String: Any]
        let photoID = (readProperties?[kCGImagePropertyMakerAppleDictionary as String] as? [String: Any])?["17"] as? String
        let videoID = asset.metadata.first { $0.key as? String == "com.apple.quicktime.content.identifier" }?.stringValue
        guard photoID == identifier, videoID == identifier,
              abs(asset.duration.seconds - Double(count) / Double(fps)) < 0.01,
              let track = asset.tracks(withMediaType: .metadata).first else {
            throw NSError(domain: "Live Photo identifier/duration verification failed", code: 9)
        }
        let reader = try AVAssetReader(asset: asset)
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
        reader.add(output)
        let readMetadata = AVAssetReaderOutputMetadataAdaptor(assetReaderTrackOutput: output)
        guard reader.startReading(), let group = readMetadata.nextTimedMetadataGroup(),
              abs(group.timeRange.start.seconds - Double(count / 2) / Double(fps)) < 0.01,
              group.items.contains(where: { $0.key as? String == "com.apple.quicktime.still-image-time" }) else {
            throw NSError(domain: "Live Photo cover metadata verification failed", code: 10)
        }
        reader.cancelReading()
        // File-only PhotoKit validation; no import or photo-library permission request.
        var completed = false
        var valid = false
        let requestID = PHLivePhoto.request(withResourceFileURLs: [url, videoURL], placeholderImage: nil, targetSize: .zero, contentMode: .aspectFit) { result, info in
            if info[PHLivePhotoInfoIsDegradedKey] as? Bool == true { return }
            valid = result != nil
            completed = true
        }
        let deadline = Date().addingTimeInterval(30)
        while !completed && Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        }
        if !completed { PHLivePhoto.cancelRequest(withRequestID: requestID) }
        guard completed && valid else { throw NSError(domain: "Apple Live Photo local loading verification failed", code: 11) }
    }
}
do { try run() } catch {
    FileHandle.standardError.write(Data("\(error)\n".utf8))
    exit(1)
}
