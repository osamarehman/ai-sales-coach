//! Rust mirror of `desktop/PROTOCOL.md` (v0).
//!
//! Text control messages ([`ClientMsg`] / [`ServerMsg`]) go over WebSocket **text** frames;
//! audio goes over **binary** frames encoded by [`encode_audio_frame`] and read by
//! [`AudioFrame::decode`]. If you change this file, change `PROTOCOL.md` in the same commit.

use serde::{Deserialize, Serialize};

/// Which side of the call a stream carries. Wire value is the leading byte of an audio frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    /// Rep microphone.
    Mic = 0,
    /// Prospect — the machine's system/loopback output.
    System = 1,
}

impl Channel {
    pub fn from_wire(b: u8) -> Option<Channel> {
        match b {
            0 => Some(Channel::Mic),
            1 => Some(Channel::System),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Linux,
    Macos,
    Windows,
    /// Mobile clients are **mic-only** — the OS forbids capturing the far end of a call, so they
    /// send channel 0 (mic) and never channel 1 (system).
    Android,
    Ios,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConsentMethod {
    Spoken,
    Checkbox,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Speaker {
    Rep,
    Prospect,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CueTier {
    Crit,
    Help,
    Fyi,
}

/// Client → server control messages (WebSocket **text** frames).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMsg {
    Hello {
        session_token: String,
        app_version: String,
        platform: Platform,
        sample_rate: u32,
        frame_samples: u32,
    },
    Consent {
        captured: bool,
        method: ConsentMethod,
        ts_ms: u64,
    },
    Bye {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
}

/// Server → client messages (WebSocket **text** frames).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMsg {
    Ready {
        session_id: String,
    },
    Cue {
        id: String,
        tier: CueTier,
        text: String,
        ttl_ms: u32,
        category: String,
        ts_ms: u64,
    },
    Transcript {
        speaker: Speaker,
        text: String,
        ts_ms: u64,
        #[serde(rename = "final")]
        is_final: bool,
    },
    Error {
        code: String,
        message: String,
    },
}

/// Header size of a binary audio frame: `channel(1) + ts_ms(8)`.
pub const AUDIO_HEADER_LEN: usize = 9;

/// Encode one channel's PCM chunk into a binary WS frame (see `PROTOCOL.md`).
pub fn encode_audio_frame(channel: Channel, ts_ms: u64, samples: &[i16]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(AUDIO_HEADER_LEN + samples.len() * 2);
    buf.push(channel as u8);
    buf.extend_from_slice(&ts_ms.to_le_bytes());
    for s in samples {
        buf.extend_from_slice(&s.to_le_bytes());
    }
    buf
}

/// A decoded binary audio frame.
#[derive(Debug, Clone, PartialEq)]
pub struct AudioFrame {
    pub channel: Channel,
    pub ts_ms: u64,
    pub samples: Vec<i16>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum DecodeError {
    TooShort,
    BadChannel(u8),
    OddPayload,
}

impl AudioFrame {
    pub fn decode(bytes: &[u8]) -> Result<AudioFrame, DecodeError> {
        if bytes.len() < AUDIO_HEADER_LEN {
            return Err(DecodeError::TooShort);
        }
        let channel = Channel::from_wire(bytes[0]).ok_or(DecodeError::BadChannel(bytes[0]))?;
        let ts_ms = u64::from_le_bytes(bytes[1..9].try_into().unwrap());
        let payload = &bytes[AUDIO_HEADER_LEN..];
        if payload.len() % 2 != 0 {
            return Err(DecodeError::OddPayload);
        }
        let samples = payload
            .chunks_exact(2)
            .map(|c| i16::from_le_bytes([c[0], c[1]]))
            .collect();
        Ok(AudioFrame {
            channel,
            ts_ms,
            samples,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audio_frame_round_trips() {
        let samples = vec![0i16, 1, -1, 32767, -32768, 12345];
        let bytes = encode_audio_frame(Channel::System, 4242, &samples);
        assert_eq!(bytes[0], 1); // system
        let f = AudioFrame::decode(&bytes).unwrap();
        assert_eq!(f.channel, Channel::System);
        assert_eq!(f.ts_ms, 4242);
        assert_eq!(f.samples, samples);
    }

    #[test]
    fn decode_rejects_short_and_odd() {
        assert_eq!(AudioFrame::decode(&[0, 1, 2]), Err(DecodeError::TooShort));
        let mut b = encode_audio_frame(Channel::Mic, 0, &[1, 2]);
        b.push(0xFF); // make payload odd
        assert_eq!(AudioFrame::decode(&b), Err(DecodeError::OddPayload));
        let mut bad = vec![9u8]; // invalid channel
        bad.extend_from_slice(&0u64.to_le_bytes());
        assert_eq!(AudioFrame::decode(&bad), Err(DecodeError::BadChannel(9)));
    }

    #[test]
    fn hello_serializes_with_tag() {
        let m = ClientMsg::Hello {
            session_token: "tok".into(),
            app_version: "0.1.0".into(),
            platform: Platform::Linux,
            sample_rate: 16000,
            frame_samples: 320,
        };
        let j = serde_json::to_value(&m).unwrap();
        assert_eq!(j["type"], "hello");
        assert_eq!(j["platform"], "linux");
        let back: ClientMsg = serde_json::from_value(j).unwrap();
        assert_eq!(back, m);
    }

    #[test]
    fn cue_and_transcript_field_names_match_contract() {
        let cue = ServerMsg::Cue {
            id: "1".into(),
            tier: CueTier::Crit,
            text: "ask a question".into(),
            ttl_ms: 7000,
            category: "talk_ratio".into(),
            ts_ms: 10,
        };
        let j = serde_json::to_value(&cue).unwrap();
        assert_eq!(j["type"], "cue");
        assert_eq!(j["tier"], "crit");

        let t = ServerMsg::Transcript {
            speaker: Speaker::Rep,
            text: "hi".into(),
            ts_ms: 1,
            is_final: true,
        };
        // Contract spells this key "final", not "is_final".
        assert_eq!(serde_json::to_value(&t).unwrap()["final"], true);
    }
}
