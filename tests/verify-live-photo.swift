// Usage: swiftc tests/verify-live-photo.swift -o /tmp/verify-live-photo
//        /tmp/verify-live-photo /absolute/path/card.jpg /absolute/path/card.mov
import Foundation
import AVFoundation
import ImageIO

let imageURL = URL(fileURLWithPath: CommandLine.arguments[1])
let videoURL = URL(fileURLWithPath: CommandLine.arguments[2])
let source = CGImageSourceCreateWithURL(imageURL as CFURL, nil)!
let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil)! as NSDictionary
let maker = properties[kCGImagePropertyMakerAppleDictionary] as! NSDictionary
let imageID = maker["17"] as! String
let asset = AVURLAsset(url: videoURL)
let videoID = asset.metadata.first { $0.key as? String == "com.apple.quicktime.content.identifier" }!.stringValue!
precondition(imageID == videoID, "Image/video identifiers differ")
precondition(abs(asset.duration.seconds - 5) < 0.01, "Unexpected duration")
let track = asset.tracks(withMediaType: .metadata).first!
let reader = try AVAssetReader(asset: asset)
let output = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
reader.add(output)
let adaptor = AVAssetReaderOutputMetadataAdaptor(assetReaderTrackOutput: output)
precondition(reader.startReading())
let group = adaptor.nextTimedMetadataGroup()!
precondition(abs(group.timeRange.start.seconds - 2.5) < 0.01, "Wrong cover time")
precondition(group.items.contains { $0.key as? String == "com.apple.quicktime.still-image-time" }, "Missing still image marker")
print("PASS: matching asset identifiers, 5-second duration, timed cover metadata at 2.5 seconds")
