// object-mask <in.jpg|png|webp> <out.png>
// Lifts the subject (a person, an animal, a thing) out of a photo: a PNG with a see-through
// background, cropped to the subject. Uses Apple Vision's foreground instance mask (on-device,
// macOS 14+). Creatro uses it for the pictures it finds to draw things on a storyboard shot
// (src/pictures.ts). Exit 3 when the photo has no clear subject.
import CoreImage
import Foundation
import Vision

let args = CommandLine.arguments
guard args.count == 3 else {
  FileHandle.standardError.write("usage: object-mask <in-image> <out.png>\n".data(using: .utf8)!)
  exit(2)
}
guard let image = CIImage(contentsOf: URL(fileURLWithPath: args[1]), options: [.applyOrientationProperty: true]) else {
  FileHandle.standardError.write("can't read \(args[1])\n".data(using: .utf8)!)
  exit(1)
}
let handler = VNImageRequestHandler(ciImage: image)
let request = VNGenerateForegroundInstanceMaskRequest()
do {
  try handler.perform([request])
} catch {
  FileHandle.standardError.write("vision: \(error.localizedDescription)\n".data(using: .utf8)!)
  exit(1)
}
guard let result = request.results?.first, !result.allInstances.isEmpty else { exit(3) }
// The largest subject only when there are several (a person, not the crowd behind them).
var keep = result.allInstances
if keep.count > 1, let mask = try? result.generateScaledMaskForImage(forInstances: result.allInstances, from: handler) {
  _ = mask
  var best = keep.first!
  var bestArea = 0
  for instance in result.allInstances {
    guard let one = try? result.generateScaledMaskForImage(forInstances: IndexSet(integer: instance), from: handler) else { continue }
    CVPixelBufferLockBaseAddress(one, .readOnly)
    let w = CVPixelBufferGetWidth(one), h = CVPixelBufferGetHeight(one), row = CVPixelBufferGetBytesPerRow(one)
    var area = 0
    if let base = CVPixelBufferGetBaseAddress(one) {
      let p = base.assumingMemoryBound(to: Float32.self)
      for y in stride(from: 0, to: h, by: 4) { for x in stride(from: 0, to: w, by: 4) where p[y * row / 4 + x] > 0.5 { area += 1 } }
    }
    CVPixelBufferUnlockBaseAddress(one, .readOnly)
    if area > bestArea { bestArea = area; best = instance }
  }
  keep = IndexSet(integer: best)
}
guard let cut = try? result.generateMaskedImage(ofInstances: keep, from: handler, croppedToInstancesExtent: true) else { exit(3) }
let out = CIImage(cvPixelBuffer: cut)
do {
  try CIContext().writePNGRepresentation(of: out, to: URL(fileURLWithPath: args[2]), format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
} catch {
  FileHandle.standardError.write("write: \(error.localizedDescription)\n".data(using: .utf8)!)
  exit(1)
}
