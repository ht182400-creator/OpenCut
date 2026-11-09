import { describe, expect, it } from 'vitest';

import { frameTimeSeconds, isVideoFile, mediaFrameAt, type DecodedMedia } from './media';

/** 媒体解码模块的纯函数回归：不启动浏览器，覆盖判定、时间映射与帧复用。 */
describe('media 纯函数', () => {
  const file = (name: string, type = ''): File => ({ name, type }) as File;

  it('按 MIME 或扩展名识别视频文件', () => {
    expect(isVideoFile(file('clip.mp4', 'video/mp4'))).toBe(true);
    expect(isVideoFile(file('clip.webm'))).toBe(true);
    expect(isVideoFile(file('clip.MOV'))).toBe(true);
    expect(isVideoFile(file('project.json', 'application/json'))).toBe(false);
  });

  it('帧时间按 fps 换算并夹在媒体时长内', () => {
    expect(frameTimeSeconds(0, 30, 2)).toBe(0);
    expect(frameTimeSeconds(30, 30, 2)).toBe(1);
    expect(Math.abs(frameTimeSeconds(59, 30, 2) - (2 - 1 / 30))).toBeLessThan(1e-9);
    expect(frameTimeSeconds(999, 30, 2)).toBeCloseTo(2 - 1 / 30, 9);
    expect(frameTimeSeconds(-5, 30, 2)).toBe(0);
  });

  it('短素材按索引循环复用帧', () => {
    const frames = [new Uint8Array([1, 2, 3, 4]), new Uint8Array([5, 6, 7, 8])];
    const media: DecodedMedia = {
      name: 'clip', frames, audio: null,
      width: 1, height: 1, durationSeconds: 0.1, fps: 30,
      fromCache: false, decodeMilliseconds: 12,
    };
    expect(mediaFrameAt(media, 0)).toBe(frames[0]);
    expect(mediaFrameAt(media, 2)).toBe(frames[0]);
    expect(mediaFrameAt(media, 3)).toBe(frames[1]);
  });

  it('空素材被明确拒绝', () => {
    const empty: DecodedMedia = {
      name: 'empty', frames: [], audio: null,
      width: 320, height: 180, durationSeconds: 0, fps: 30,
      fromCache: true, decodeMilliseconds: 0,
    };
    expect(() => mediaFrameAt(empty, 0)).toThrow(/没有可用帧/);
  });
});
