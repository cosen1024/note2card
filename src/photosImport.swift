import AppKit
import Photos

struct ImportItem: Decodable { let photo: String; let video: String? }
struct ImportJob: Decodable { let items: [ImportItem] }

// Launched as a small app so macOS can display a proper Photos permission prompt.
final class ImportDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let flag = CommandLine.arguments.firstIndex(of: "--job"), flag + 1 < CommandLine.arguments.count else {
            NSApp.terminate(nil); return
        }
        let directory = URL(fileURLWithPath: CommandLine.arguments[flag + 1])
        func finish(_ success: Bool, _ message: String) {
            let result: [String: Any] = ["success": success, "message": message]
            if let data = try? JSONSerialization.data(withJSONObject: result) {
                try? data.write(to: directory.appendingPathComponent("result.json"), options: .atomic)
            }
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
        do {
            let job = try JSONDecoder().decode(ImportJob.self, from: Data(contentsOf: directory.appendingPathComponent("job.json")))
            guard !job.items.isEmpty else { finish(false, "没有可导入的卡片"); return }
            for item in job.items {
                guard FileManager.default.fileExists(atPath: item.photo), item.video == nil || FileManager.default.fileExists(atPath: item.video!) else {
                    finish(false, "导入素材不完整"); return
                }
            }
            PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
                guard status == .authorized || status == .limited else {
                    finish(false, "未获得添加照片权限，请在系统设置 → 隐私与安全性 → 照片中允许 Note to Card Photos 后重试")
                    return
                }
                PHPhotoLibrary.shared().performChanges({
                    for item in job.items {
                        let request = PHAssetCreationRequest.forAsset()
                        request.addResource(with: .photo, fileURL: URL(fileURLWithPath: item.photo), options: nil)
                        if let video = item.video {
                            request.addResource(with: .pairedVideo, fileURL: URL(fileURLWithPath: video), options: nil)
                        }
                    }
                }) { success, error in
                    finish(success, success ? "已将 \(job.items.count) 张卡片存入照片" : (error?.localizedDescription ?? "照片图库保存失败"))
                }
            }
        } catch { finish(false, error.localizedDescription) }
    }
}

let application = NSApplication.shared
let delegate = ImportDelegate()
application.delegate = delegate
application.setActivationPolicy(.accessory)
application.run()
