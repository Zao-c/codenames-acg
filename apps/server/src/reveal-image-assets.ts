import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const MAX_DATA_URL_LENGTH = 3_200_000;
const IMAGE_MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export class RevealImageAssetStore {
  constructor(private readonly dir: string) {}

  async ensureReady(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  getStaticDir(): string {
    return this.dir;
  }

  async normalizeImageUrl(imageUrl: string): Promise<string> {
    const trimmed = imageUrl.trim();
    if (!trimmed) {
      throw new Error("图片不能为空");
    }
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      return trimmed;
    }
    if (!trimmed.startsWith("data:image/")) {
      throw new Error("图片 URL 必须以 http(s):// 开头或为 data:image/...;base64");
    }
    return this.saveDataUrl(trimmed);
  }

  private async saveDataUrl(dataUrl: string): Promise<string> {
    if (dataUrl.length > MAX_DATA_URL_LENGTH) {
      throw new Error("图片过大，请压缩后重试（建议最长边不超过 1280px）");
    }

    const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) {
      throw new Error("不支持的图片格式，仅支持 PNG / JPEG / WebP");
    }

    const mime = match[1];
    const ext = IMAGE_MIME_EXT[mime];
    if (!ext) {
      throw new Error("不支持的图片格式，仅支持 PNG / JPEG / WebP");
    }

    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length === 0) {
      throw new Error("图片内容为空");
    }

    await this.ensureReady();
    const assetId = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString("hex")}.${ext}`;
    await fs.writeFile(path.join(this.dir, assetId), buffer);
    return `/api/reveal-images/${assetId}`;
  }
}
