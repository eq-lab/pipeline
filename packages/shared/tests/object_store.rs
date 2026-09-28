//! Pure-compute tests for `shared::object_store` — content sniffing, key
//! layout, and download-header construction. No network, no bucket.

use shared::object_store::{
    content_disposition, extension_for, object_key, sniff_content_type, ACCEPTED_CONTENT_TYPES,
};
use uuid::Uuid;

#[test]
fn sniffs_the_accepted_types_from_their_leading_bytes() {
    assert_eq!(
        sniff_content_type(b"%PDF-1.7\n1 0 obj"),
        Some("application/pdf")
    );
    assert_eq!(
        sniff_content_type(&[0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]),
        Some("image/jpeg")
    );
    assert_eq!(
        sniff_content_type(b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"),
        Some("image/png")
    );
}

#[test]
fn rejects_a_file_whose_name_lies_about_its_contents() {
    assert_eq!(sniff_content_type(b"MZ\x90\x00\x03"), None);
    assert_eq!(sniff_content_type(b"#!/bin/sh\nrm -rf /"), None);
    assert_eq!(sniff_content_type(b"<?xml version=\"1.0\"?>"), None);
}

#[test]
fn rejects_input_too_short_to_identify() {
    assert_eq!(sniff_content_type(b""), None);
    assert_eq!(sniff_content_type(b"%PD"), None);
    assert_eq!(sniff_content_type(&[0xFF, 0xD8]), None);
}

#[test]
fn every_accepted_type_has_an_extension() {
    for content_type in ACCEPTED_CONTENT_TYPES {
        assert!(
            extension_for(content_type).is_some(),
            "no extension for {content_type}"
        );
    }
    assert_eq!(extension_for("application/x-msdownload"), None);
}

#[test]
fn object_keys_are_namespaced_by_lp_and_carry_no_caller_input() {
    let id = Uuid::nil();
    let key = object_key(42, id, "pdf");
    assert_eq!(key, "lps/42/00000000-0000-0000-0000-000000000000.pdf");
    assert!(key.starts_with("lps/42/"));
}

#[test]
fn distinct_uploads_never_collide() {
    let first = object_key(1, Uuid::new_v4(), "pdf");
    let second = object_key(1, Uuid::new_v4(), "pdf");
    assert_ne!(first, second);
}

#[test]
fn content_disposition_restores_a_plain_filename() {
    let header = content_disposition("certificate.pdf");
    assert!(header.starts_with("attachment; "));
    assert!(header.contains("filename=\"certificate.pdf\""));
    assert!(header.contains("filename*=UTF-8''certificate.pdf"));
}

#[test]
fn content_disposition_neutralises_header_injection() {
    let header = content_disposition("a\"; evil=1\r\nX-Injected: yes.pdf");
    assert!(!header.contains('\r'), "CR survived into the header");
    assert!(!header.contains('\n'), "LF survived into the header");

    let quoted = header
        .split("filename=\"")
        .nth(1)
        .and_then(|rest| rest.split('"').next())
        .expect("a quoted filename");
    assert!(!quoted.contains('"'));
    assert!(!quoted.contains('\\'));
}

#[test]
fn content_disposition_carries_non_ascii_names_in_the_encoded_form() {
    let header = content_disposition("Übersicht.pdf");
    assert!(header.contains("filename*=UTF-8''%C3%9Cbersicht.pdf"));
    assert!(header.contains("filename=\"_bersicht.pdf\""));
}

#[test]
fn content_disposition_falls_back_when_the_name_is_unusable() {
    let header = content_disposition("\u{0}\u{1}");
    assert!(header.contains("filename=\"document\""));
}
