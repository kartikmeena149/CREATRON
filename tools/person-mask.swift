// person-mask <in.mp4> <out-mask.mp4>
// Writes a black-and-white video, same size and timing as the input: white where a person is.
// Uses Apple Vision's person segmentation (on-device). Creatron's Auto Edit merges it with the
// picture into a see-through speaker cutout (autoedit-tools.ts cutout).
import AVFoundation
import CoreImage
import Vision

let args = CommandLine.arguments
guard args.count == 3 else {
  FileHandle.standardError.write("usage: person-mask <in.mp4> <out-mask.mp4>\n".data(using: .utf8)!)
  exit(2)
}
let input = URL(fileURLWithPath: args[1])
let output = URL(fileURLWithPath: args[2])
try? FileManager.default.removeItem(at: output)

let asset = AVURLAsset(url: input)
let sem = DispatchSemaphore(value: 0)
var track: AVAssetTrack?
var size = CGSize.zero
var transform = CGAffineTransform.identity
var fps: Float = 30
Task {
  track = try? await asset.loadTracks(withMediaType: .video).first
  if let t = track {
    size = try await t.load(.naturalSize)
    transform = try await t.load(.preferredTransform)
    fps = try await t.load(.nominalFrameRate)
  }
  sem.signal()
}
sem.wait()
guard let videoTrack = track else { fatalError("no video track") }
// Phone footage is often stored sideways with a rotation flag: work upright.
let upright = CGRect(origin: .zero, size: size).applying(transform).standardized.size
let width = Int(upright.width), height = Int(upright.height)

let reader = try AVAssetReader(asset: asset)
let readerOut = AVAssetReaderTrackOutput(track: videoTrack, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
reader.add(readerOut)
let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
let writerIn = AVAssetWriterInput(mediaType: .video, outputSettings: [
  AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height,
  AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 8_000_000],
])
writerIn.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: writerIn, sourcePixelBufferAttributes: [
  kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height,
])
writer.add(writerIn)
reader.startReading()
writer.startWriting()
writer.startSession(atSourceTime: .zero)

let context = CIContext()
let request = VNGeneratePersonSegmentationRequest()
request.qualityLevel = .accurate
request.outputPixelFormat = kCVPixelFormatType_OneComponent8
let orientation: CGImagePropertyOrientation = {
  // Map the track's rotation to what Vision should treat as "up".
  let angle = atan2(transform.b, transform.a)
  if abs(angle - .pi / 2) < 0.1 { return .right }
  if abs(angle + .pi / 2) < 0.1 { return .left }
  if abs(abs(angle) - .pi) < 0.1 { return .down }
  return .up
}()

var frames = 0
while let sample = readerOut.copyNextSampleBuffer() {
  guard let pixels = CMSampleBufferGetImageBuffer(sample) else { continue }
  let time = CMSampleBufferGetPresentationTimeStamp(sample)
  let handler = VNImageRequestHandler(cvPixelBuffer: pixels, orientation: orientation)
  try handler.perform([request])
  guard let mask = request.results?.first?.pixelBuffer else { continue }
  let m = CIImage(cvPixelBuffer: mask)
  let scaled = m.transformed(by: CGAffineTransform(scaleX: CGFloat(width) / m.extent.width, y: CGFloat(height) / m.extent.height))
  var out: CVPixelBuffer?
  CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &out)
  context.render(scaled, to: out!)
  while !writerIn.isReadyForMoreMediaData { usleep(2000) }
  adaptor.append(out!, withPresentationTime: time)
  frames += 1
  if frames % 60 == 0 { print("frames \(frames)") }
}
writerIn.markAsFinished()
let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
done.wait()
if writer.status != .completed { fatalError("writing failed: \(String(describing: writer.error))") }
print("mask: \(frames) frames, \(width)x\(height) at \(fps) fps")
