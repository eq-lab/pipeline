//! S3-compatible object storage for KYB supporting documents (Issue #1267).
//!
//! Backs `routes::lps`. Targets DigitalOcean Spaces, which speaks S3 — the only
//! thing that makes it Spaces rather than AWS is `endpoint_url`. Credentials are
//! static (`SPACES_ACCESS_KEY_ID` / `SPACES_SECRET_ACCESS_KEY`), so no
//! credential-provider chain and no `aws-config` dependency: the API is handed
//! one key pair by its environment and never assumes a role.
//!
//! The bucket is **private**. Nothing is ever served from it directly; readers
//! get a short-lived presigned GET produced by [`ObjectStore::presigned_get`],
//! which is a local HMAC computation rather than a call to Spaces, so embedding
//! one per document in a listing response costs nothing.
//!
//! Object keys are `lps/<lp_id>/<uuid>.<ext>` — never the client's filename,
//! which is attacker-controlled. The original name is carried in the DB and
//! re-attached at download time via `Content-Disposition`.

use std::fmt::Write as _;
use std::time::Duration;

use anyhow::{Context, Result};
use aws_sdk_s3::config::{Credentials, Region};
use aws_sdk_s3::presigning::PresigningConfig;
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::Client;
use uuid::Uuid;

/// How long a presigned download URL stays valid. Long enough that a reviewer
/// working through a document set does not hit dead links mid-read, short
/// enough that a leaked URL is not a lasting grant.
pub const DOWNLOAD_URL_TTL: Duration = Duration::from_mins(15);

/// The content types a KYB document may have. Mirrors the frontend's
/// `ACCEPTED_FILE_TYPES` in `packages/frontend/src/components/kybFileValidation.ts`
/// — the server must not reject what the form accepted, nor accept what it
/// refused.
pub const ACCEPTED_CONTENT_TYPES: [&str; 3] = ["application/pdf", "image/jpeg", "image/png"];

/// Identify a document's content type from its leading bytes.
///
/// The multipart `Content-Type` header is supplied by the client and means
/// nothing; this is what actually decides whether a file is accepted. Returns
/// `None` for anything that is not one of [`ACCEPTED_CONTENT_TYPES`], including
/// a renamed executable.
pub fn sniff_content_type(bytes: &[u8]) -> Option<&'static str> {
    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n";

    if bytes.starts_with(b"%PDF-") {
        return Some("application/pdf");
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg");
    }
    if bytes.starts_with(PNG) {
        return Some("image/png");
    }
    None
}

/// The filename extension stored for a sniffed content type. Total over
/// [`ACCEPTED_CONTENT_TYPES`]; `None` can only mean a caller invented a type.
pub fn extension_for(content_type: &str) -> Option<&'static str> {
    match content_type {
        "application/pdf" => Some("pdf"),
        "image/jpeg" => Some("jpg"),
        "image/png" => Some("png"),
        _ => None,
    }
}

/// Build the object key for a document. The UUID — not the client's filename —
/// is what makes the key unguessable and collision-free; the `lps/<lp_id>/`
/// prefix keeps one LP's documents together for lifecycle rules and manual
/// inspection.
pub fn object_key(lp_id: i64, id: Uuid, extension: &str) -> String {
    format!("lps/{lp_id}/{id}.{extension}")
}

/// A `Content-Disposition` value that restores the uploader's filename on
/// download without letting it inject headers.
///
/// The name reaches us from a multipart part and is fully attacker-controlled,
/// so the quoted `filename=` form carries an ASCII-sanitised version (CR, LF,
/// quotes, backslashes and control bytes replaced), and the real name rides in
/// the RFC 5987 `filename*=` form where percent-encoding makes it inert.
pub fn content_disposition(filename: &str) -> String {
    let ascii: String = filename
        .chars()
        .map(|c| {
            if c.is_ascii() && !c.is_ascii_control() && c != '"' && c != '\\' {
                c
            } else {
                '_'
            }
        })
        .collect();
    // A name that sanitised down to nothing usable — empty, whitespace, or all
    // replacement underscores — would present as a blank or `___` download, so
    // fall back to something a reader can act on. The real name still rides in
    // the `filename*=` form below.
    let ascii = if ascii.chars().any(|c| c.is_ascii_alphanumeric()) {
        ascii
    } else {
        "document".to_owned()
    };

    let mut encoded = String::with_capacity(filename.len());
    for byte in filename.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(*byte as char);
        } else {
            let _ = write!(encoded, "%{byte:02X}");
        }
    }

    format!("attachment; filename=\"{ascii}\"; filename*=UTF-8''{encoded}")
}

/// A private S3-compatible bucket holding KYB documents.
#[derive(Debug, Clone)]
pub struct ObjectStore {
    client: Client,
    bucket: String,
}

impl ObjectStore {
    /// Build a client against a Spaces (or any S3-compatible) endpoint from a
    /// static key pair. Performs no I/O — a wrong endpoint or a bad key is only
    /// discovered on the first [`put`](Self::put).
    pub fn new(
        access_key_id: &str,
        secret_access_key: &str,
        endpoint: &str,
        region: &str,
        bucket: &str,
    ) -> Self {
        let credentials = Credentials::new(
            access_key_id,
            secret_access_key,
            None,
            None,
            "pipeline-static",
        );
        let config = aws_sdk_s3::Config::builder()
            .behavior_version_latest()
            .region(Region::new(region.to_owned()))
            .endpoint_url(endpoint)
            .credentials_provider(credentials)
            .build();

        Self {
            client: Client::from_conf(config),
            bucket: bucket.to_owned(),
        }
    }

    pub fn bucket(&self) -> &str {
        &self.bucket
    }

    /// Store `bytes` at `key`. No ACL is set, so the object inherits the
    /// bucket's private default — a KYB document must never be publicly
    /// readable.
    pub async fn put(&self, key: &str, content_type: &str, bytes: Vec<u8>) -> Result<()> {
        self.client
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .content_type(content_type)
            .body(ByteStream::from(bytes))
            .send()
            .await
            .with_context(|| format!("storing object `{key}`"))?;
        Ok(())
    }

    /// Remove the object at `key`. S3 delete is idempotent — removing a key
    /// that is already gone succeeds — so a caller retrying after a partial
    /// failure does not need to special-case it.
    pub async fn delete(&self, key: &str) -> Result<()> {
        self.client
            .delete_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
            .with_context(|| format!("deleting object `{key}`"))?;
        Ok(())
    }

    /// A presigned GET for `key`, valid for [`DOWNLOAD_URL_TTL`], that downloads
    /// as `original_filename`. Signing is local; this never contacts Spaces.
    pub async fn presigned_get(&self, key: &str, original_filename: &str) -> Result<String> {
        let config =
            PresigningConfig::expires_in(DOWNLOAD_URL_TTL).context("building presigning config")?;
        let request = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .response_content_disposition(content_disposition(original_filename))
            .presigned(config)
            .await
            .with_context(|| format!("presigning object `{key}`"))?;
        Ok(request.uri().to_owned())
    }
}
