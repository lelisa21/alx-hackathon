import sharp from "sharp";

const formats = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
} as const;
export async function validateHelpImage(
  data: Buffer,
  mime: string,
): Promise<Buffer | null> {
  if (!(mime in formats) || data.length === 0 || data.length > 2097152)
    return null;
  try {
    const input = sharp(data, {
      failOn: "warning",
      limitInputPixels: 16000000,
    });
    const metadata = await input.metadata();
    if (
      metadata.format !== formats[mime as keyof typeof formats] ||
      (metadata.pages ?? 1) > 1
    )
      return null;
    // A full decode/re-encode validates pixels and strips EXIF/GPS/comments.
    const normalized = await input
      .rotate()
      .toFormat(formats[mime as keyof typeof formats])
      .toBuffer();
    return normalized.length <= 2097152 ? normalized : null;
  } catch {
    return null;
  }
}
