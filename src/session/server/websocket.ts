import { randomUUID } from "node:crypto";
import type { Socket } from "node:net";

export class WebSocketConnection {
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  user = "defaultuser";
  clientId: string = randomUUID();
  authenticated = false;

  constructor(
    private readonly socket: Socket,
    private readonly onText: (message: string) => void,
  ) {
    socket.on("data", (chunk) => this.handleData(chunk));
    socket.on("error", () => {
      this.destroy();
    });
  }

  sendJson(payload: unknown): void {
    if (this.socket.destroyed || this.socket.writableEnded) {
      return;
    }
    this.socket.write(encodeFrame(0x1, Buffer.from(JSON.stringify(payload))));
  }

  close(): void {
    if (!this.socket.destroyed && !this.socket.writableEnded) {
      this.socket.end(encodeFrame(0x8, Buffer.alloc(0)));
    }
  }

  destroy(): void {
    this.socket.destroy();
  }

  private handleData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const frame = readFrame(this.buffer);
      if (frame === undefined) {
        return;
      }
      this.buffer = frame.remaining;
      if (frame.opcode === 0x8) {
        this.close();
        return;
      }
      if (frame.opcode === 0x9) {
        this.socket.write(encodeFrame(0xa, frame.payload));
        continue;
      }
      if (frame.opcode !== 0x1) {
        continue;
      }
      this.onText(frame.payload.toString("utf8"));
    }
  }
}

interface DecodedFrame {
  opcode: number;
  payload: Buffer;
  remaining: Buffer;
}

function readFrame(buffer: Buffer): DecodedFrame | undefined {
  if (buffer.length < 2) {
    return undefined;
  }
  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < offset + 2) {
      return undefined;
    }
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) {
      return undefined;
    }
    const bigLength = buffer.readBigUInt64BE(offset);
    if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("WebSocket frame is too large");
    }
    length = Number(bigLength);
    offset += 8;
  }
  const maskLength = masked ? 4 : 0;
  if (buffer.length < offset + maskLength + length) {
    return undefined;
  }
  const mask = masked ? buffer.subarray(offset, offset + 4) : undefined;
  offset += maskLength;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask !== undefined) {
    for (let i = 0; i < payload.length; i += 1) {
      payload[i] ^= mask[i % 4];
    }
  }
  return {
    opcode,
    payload,
    remaining: buffer.subarray(offset + length),
  };
}

function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length;
  if (length < 126) {
    return Buffer.concat([Buffer.from([0x80 | opcode, length]), payload]);
  }
  if (length <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, payload]);
}
