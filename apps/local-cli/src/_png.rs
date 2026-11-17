//! 手写 PNG 编码（W-13 C 批）：RGBA8 像素 → 合法 PNG 字节，零第三方图像库。
//!
//! 采用 PNG 规范的 stored DEFLATE（无压缩块）：每个 chunk = 长度(4) + 类型(4) + 数据 + CRC32(4)。
//! IHDR 声明颜色类型 6（RGBA8），保留 core `RenderFrame` 的 alpha；逐行以 filter=0（None）前缀。
//! 这样 headless 输出的 PNG 与 WASM/浏览器侧逐像素一致，可直接用于 golden master 比对。

/// PNG 签名（8 字节）。
const PNG_SIGNATURE: [u8; 8] = [137, 80, 78, 71, 13, 10, 26, 10];
/// IHDR 数据长度。
const IHDR_LEN: usize = 13;
/// 颜色类型 6 = 真彩色 + alpha（RGBA8）。
const COLOR_TYPE_RGBA: u8 = 6;
/// 位深度 8。
const BIT_DEPTH: u8 = 8;
/// 行过滤器 0 = None。
const FILTER_NONE: u8 = 0;
/// stored DEFLATE 块首字节的 BFINAL 位（BTYPE=00）。
const DEFLATE_FINAL_MASK: u8 = 0x01;
/// zlib 头（CMF/FLG），窗口 32K、无字典、校验位使 (CMF<<8|FLG)%31==0。
const ZLIB_HEADER: [u8; 2] = [0x78, 0x01];
/// LEN/NLEN 上限：stored 块长度字段为 u16。
const MAX_STORED_BLOCK: usize = 65535;
/// stored 块头开销：BFINAL/BTYPE(1) + LEN(2) + NLEN(2)。
const STORED_BLOCK_OVERHEAD: usize = 5;
/// CRC32 多项式（IEEE 802.3，反射形式）。
const CRC32_POLYNOMIAL: u32 = 0xEDB8_8320;
/// Adler32 模数。
const ADLER_MOD: u32 = 65521;

/// 计算 CRC32（反射多项式，逐字节）。
fn crc32(bytes: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFF_FFFF;
    for &byte in bytes {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            crc = if crc & 1 != 0 {
                (crc >> 1) ^ CRC32_POLYNOMIAL
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

/// 计算 Adler32（zlib 校验和）。
fn adler32(bytes: &[u8]) -> u32 {
    let mut a: u32 = 1;
    let mut b: u32 = 0;
    for &byte in bytes {
        a = (a + u32::from(byte)) % ADLER_MOD;
        b = (b + a) % ADLER_MOD;
    }
    (b << 16) | a
}

/// 追加一个 PNG chunk：长度 + 类型 + 数据 + CRC32(type||data)。
fn push_chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(kind);
    out.extend_from_slice(data);
    let mut crc_input = Vec::with_capacity(4 + data.len());
    crc_input.extend_from_slice(kind);
    crc_input.extend_from_slice(data);
    out.extend_from_slice(&crc32(&crc_input).to_be_bytes());
}

/// 对原始字节流做 stored DEFLATE + zlib 封装（无压缩，确定性）。
fn zlib_stored(raw: &[u8]) -> Vec<u8> {
    let block_count = if raw.is_empty() {
        1
    } else {
        raw.len().div_ceil(MAX_STORED_BLOCK)
    };
    let mut out =
        Vec::with_capacity(ZLIB_HEADER.len() + block_count * STORED_BLOCK_OVERHEAD + raw.len() + 4);
    out.extend_from_slice(&ZLIB_HEADER);

    if raw.is_empty() {
        out.push(DEFLATE_FINAL_MASK);
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&(!0u16).to_le_bytes());
    } else {
        for chunk in raw.chunks(MAX_STORED_BLOCK) {
            let len = chunk.len() as u16;
            // 首块先写 0x00（非最终块），循环结束后把最后一块的 BFINAL 置 1。
            out.push(0x00);
            out.extend_from_slice(&len.to_le_bytes());
            out.extend_from_slice(&(!len).to_le_bytes());
            out.extend_from_slice(chunk);
        }
        // 定位最后一个块头并置 BFINAL=1：从 zlib 头起按块长度线性推进。
        let mut pos = ZLIB_HEADER.len();
        let mut last_header = pos;
        while pos < out.len() {
            last_header = pos;
            let len = u16::from_le_bytes([out[pos + 1], out[pos + 2]]) as usize;
            pos += STORED_BLOCK_OVERHEAD + len;
        }
        out[last_header] |= DEFLATE_FINAL_MASK;
    }
    out.extend_from_slice(&adler32(raw).to_be_bytes());
    out
}

/**
 * 把 RGBA8 像素编码为合法 PNG 字节。
 * @param pixels_rgba 行优先 RGBA8，长度必须等于 width*height*4
 * @param width 像素宽
 * @param height 像素高
 * @returns {Result<Vec<u8>, String>} PNG 文件字节；尺寸或像素长度非法时给中文错误
 */
pub fn rgba_to_png(pixels_rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    if width == 0 || height == 0 {
        return Err("PNG 宽高必须大于 0".to_owned());
    }
    let expected = (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "PNG 尺寸过大，像素数溢出".to_owned())?;
    if pixels_rgba.len() != expected {
        return Err(format!(
            "PNG 像素长度不匹配：期望 {expected} 字节，实际 {} 字节",
            pixels_rgba.len()
        ));
    }

    // 逐行加 filter=0 前缀，构成原始扫描流。
    let row_len = width as usize * 4;
    let mut raw = Vec::with_capacity(height as usize * (row_len + 1));
    for row in pixels_rgba.chunks_exact(row_len) {
        raw.push(FILTER_NONE);
        raw.extend_from_slice(row);
    }
    let compressed = zlib_stored(&raw);

    let mut out = Vec::with_capacity(8 + (IHDR_LEN + 12) + (compressed.len() + 12) + 12);
    out.extend_from_slice(&PNG_SIGNATURE);
    let mut ihdr = Vec::with_capacity(IHDR_LEN);
    ihdr.extend_from_slice(&width.to_be_bytes());
    ihdr.extend_from_slice(&height.to_be_bytes());
    ihdr.push(BIT_DEPTH);
    ihdr.push(COLOR_TYPE_RGBA);
    ihdr.push(0); // compression method 0
    ihdr.push(0); // filter method 0
    ihdr.push(0); // interlace 0
    push_chunk(&mut out, b"IHDR", &ihdr);
    push_chunk(&mut out, b"IDAT", &compressed);
    push_chunk(&mut out, b"IEND", &[]);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn png_has_valid_signature_and_chunks() {
        let png = rgba_to_png(&[255, 0, 0, 255], 1, 1).unwrap();
        assert_eq!(&png[..8], &PNG_SIGNATURE);
        assert_eq!(&png[12..16], b"IHDR");
        // IEND 位于末尾：长度 0 + 类型 + CRC32(b"IEND")。
        assert_eq!(&png[png.len() - 8..png.len() - 4], b"IEND");
        assert_eq!(
            u32::from_be_bytes(png[png.len() - 4..].try_into().unwrap()),
            crc32(b"IEND")
        );
    }

    #[test]
    fn png_rejects_bad_input() {
        assert!(rgba_to_png(&[], 0, 1).is_err());
        assert!(rgba_to_png(&[0, 0, 0], 1, 1).is_err());
    }

    #[test]
    fn crc32_and_adler32_known_vectors() {
        assert_eq!(crc32(b"IEND"), 0xAE42_6082);
        assert_eq!(adler32(b""), 1);
    }

    #[test]
    fn zlib_stored_roundtrip_block_headers() {
        // 跨越单个 stored 块（65535）时，最后一块必须置 BFINAL。
        let raw = vec![7u8; MAX_STORED_BLOCK + 3];
        let z = zlib_stored(&raw);
        assert_eq!(&z[..2], &ZLIB_HEADER);
        // 遍历块头验证 LEN/NLEN 互补，最后一块 BFINAL=1。
        let mut pos = 2;
        let mut seen = 0;
        let mut final_seen = false;
        while pos < z.len() - 4 {
            let header = z[pos];
            let len = u16::from_le_bytes([z[pos + 1], z[pos + 2]]) as usize;
            assert_eq!(u16::from_le_bytes([z[pos + 3], z[pos + 4]]), !(len as u16));
            seen += len;
            final_seen = header & DEFLATE_FINAL_MASK != 0;
            pos += STORED_BLOCK_OVERHEAD + len;
        }
        assert_eq!(seen, raw.len());
        assert!(final_seen);
    }
}
