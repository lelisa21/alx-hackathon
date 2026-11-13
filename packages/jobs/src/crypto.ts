import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

export class ContactCipher {
  private readonly encryptionKey: Buffer;
  private readonly hashKey: Buffer;
  constructor(encryptionKey: Buffer, hashKey: Buffer) {
    if (
      encryptionKey.length !== 32 ||
      hashKey.length < 32 ||
      encryptionKey.equals(hashKey)
    )
      throw new Error("Separate encryption and hash keys are required.");
    this.encryptionKey = Buffer.from(encryptionKey);
    this.hashKey = Buffer.from(hashKey);
  }
  encrypt(value: string, context: string): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    cipher.setAAD(Buffer.from(context));
    const encrypted = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([
      Buffer.from([1]),
      iv,
      cipher.getAuthTag(),
      encrypted,
    ]);
  }
  decrypt(value: Buffer, context: string): string {
    if (value[0] !== 1 || value.length < 29)
      throw new Error("Invalid encrypted value.");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.encryptionKey,
      value.subarray(1, 13),
    );
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(value.subarray(13, 29));
    return Buffer.concat([
      decipher.update(value.subarray(29)),
      decipher.final(),
    ]).toString("utf8");
  }
  hash(channel: string, contact: string): string {
    return createHmac("sha256", this.hashKey)
      .update(JSON.stringify([channel, contact]))
      .digest("hex");
  }
}
