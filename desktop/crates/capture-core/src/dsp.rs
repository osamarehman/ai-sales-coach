//! Pure audio math: interleaved multi-channel f32 (whatever the device gives us) →
//! mono i16 at the wire sample rate. No I/O, fully unit-testable headless.

/// Decode interleaved little-endian f32 bytes (the wire layout both PulseAudio and WASAPI hand us)
/// into f32 samples. A trailing partial (<4-byte) tail is ignored — every full sample is decoded.
pub fn le_f32_bytes_to_samples(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

/// Average interleaved `channels`-wide f32 frames down to mono. `channels == 0` yields no audio
/// (guards the `chunks(0)` panic); `channels == 1` is a straight copy.
pub fn downmix_to_mono(interleaved: &[f32], channels: usize) -> Vec<f32> {
    match channels {
        0 => Vec::new(),
        1 => interleaved.to_vec(),
        _ => interleaved
            .chunks(channels)
            .map(|frame| frame.iter().sum::<f32>() / frame.len() as f32)
            .collect(),
    }
}

/// Linear-interpolation resampler for mono f32. Good enough for speech STT; not hi-fi.
pub fn resample_linear(input: &[f32], in_rate: u32, out_rate: u32) -> Vec<f32> {
    if in_rate == out_rate || input.len() < 2 {
        return input.to_vec();
    }
    let ratio = out_rate as f64 / in_rate as f64;
    let out_len = ((input.len() as f64) * ratio).round() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src = i as f64 / ratio;
        let idx = src.floor() as usize;
        let frac = (src - idx as f64) as f32;
        let a = input[idx.min(input.len() - 1)];
        let b = input[(idx + 1).min(input.len() - 1)];
        out.push(a + (b - a) * frac);
    }
    out
}

/// Clamp [-1.0, 1.0] f32 to PCM16.
pub fn f32_to_i16(input: &[f32]) -> Vec<i16> {
    input
        .iter()
        .map(|&s| (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)
        .collect()
}

/// Device frames (interleaved f32 at `in_rate`, `channels` wide) → mono PCM16 at `out_rate`.
pub fn to_mono_pcm16(interleaved: &[f32], channels: usize, in_rate: u32, out_rate: u32) -> Vec<i16> {
    let mono = downmix_to_mono(interleaved, channels);
    let resampled = resample_linear(&mono, in_rate, out_rate);
    f32_to_i16(&resampled)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downmix_averages_stereo() {
        // L/R interleaved: (1,-1) -> 0 ; (0.5,0.5) -> 0.5
        assert_eq!(downmix_to_mono(&[1.0, -1.0, 0.5, 0.5], 2), vec![0.0, 0.5]);
    }

    #[test]
    fn downmix_passthrough_mono() {
        assert_eq!(downmix_to_mono(&[0.1, 0.2], 1), vec![0.1, 0.2]);
    }

    #[test]
    fn downmix_zero_channels_is_empty() {
        // 0 channels must not panic on chunks(0); no channels -> no audio.
        assert!(downmix_to_mono(&[0.1, 0.2], 0).is_empty());
    }

    #[test]
    fn le_f32_bytes_decode_roundtrip() {
        let mut bytes = Vec::new();
        for v in [0.0f32, 1.0, -1.0, 0.25] {
            bytes.extend_from_slice(&v.to_le_bytes());
        }
        assert_eq!(le_f32_bytes_to_samples(&bytes), vec![0.0, 1.0, -1.0, 0.25]);
    }

    #[test]
    fn le_f32_bytes_ignore_partial_tail() {
        // 4 good bytes + 1 stray byte -> exactly one decoded sample, tail dropped.
        let mut bytes = 1.0f32.to_le_bytes().to_vec();
        bytes.push(0xAB);
        assert_eq!(le_f32_bytes_to_samples(&bytes), vec![1.0]);
    }

    #[test]
    fn resample_halves_length_going_down() {
        let input: Vec<f32> = (0..100).map(|i| i as f32).collect();
        let out = resample_linear(&input, 32000, 16000);
        assert_eq!(out.len(), 50); // 100 * 16000/32000
    }

    #[test]
    fn resample_noop_when_rates_match() {
        let input = vec![0.1, 0.2, 0.3];
        assert_eq!(resample_linear(&input, 16000, 16000), input);
    }

    #[test]
    fn f32_to_i16_clamps() {
        assert_eq!(f32_to_i16(&[0.0, 1.0, -1.0, 2.0, -2.0]), vec![0, i16::MAX, -i16::MAX, i16::MAX, -i16::MAX]);
    }

    #[test]
    fn full_pipeline_stereo_48k_to_mono_16k() {
        // 48k stereo -> 16k mono should cut sample count ~6x (2ch downmix + 3x rate).
        let interleaved: Vec<f32> = (0..960).map(|i| (i % 7) as f32 / 7.0).collect(); // 480 stereo frames
        let out = to_mono_pcm16(&interleaved, 2, 48000, 16000);
        assert_eq!(out.len(), 160); // 480 mono samples -> *16000/48000 = 160
    }
}
