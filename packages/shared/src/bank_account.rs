// spec: docs/product-specs/kyb-lp-verification.md#settlement-bank-account

use std::fmt;

use serde::{Deserialize, Serialize};

const NAME_MAX_CHARS: usize = 140;
const ADDRESS_MAX_CHARS: usize = 280;

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SettlementBankAccount {
    pub account_holder_name: String,
    pub bank_name: String,
    pub bank_address: Option<String>,
    pub account_number: Option<String>,
    pub iban: Option<String>,
    pub swift_bic_code: Option<String>,
    pub routing_number: Option<String>,
}

impl fmt::Debug for SettlementBankAccount {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let redact = |v: &Option<String>| v.as_ref().map(|_| "<redacted>");
        f.debug_struct("SettlementBankAccount")
            .field("bank_name", &self.bank_name)
            .field("account_number", &redact(&self.account_number))
            .field("iban", &redact(&self.iban))
            .field("routing_number", &redact(&self.routing_number))
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Default, Deserialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SettlementBankAccountInput {
    pub account_holder_name: Option<String>,
    pub bank_name: Option<String>,
    pub bank_address: Option<String>,
    pub account_number: Option<String>,
    pub iban: Option<String>,
    pub swift_bic_code: Option<String>,
    pub routing_number: Option<String>,
}

impl fmt::Debug for SettlementBankAccountInput {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SettlementBankAccountInput")
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BankAccountError {
    pub field: &'static str,
    pub reason: &'static str,
}

impl fmt::Display for BankAccountError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.field, self.reason)
    }
}

impl std::error::Error for BankAccountError {}

fn err(field: &'static str, reason: &'static str) -> BankAccountError {
    BankAccountError { field, reason }
}

fn clean(v: Option<&str>) -> Option<String> {
    v.map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

fn required(v: Option<&str>, field: &'static str, max: usize) -> Result<String, BankAccountError> {
    let s = clean(v).ok_or(err(field, "is required"))?;
    if s.chars().count() > max {
        return Err(err(field, "is too long"));
    }
    Ok(s)
}

fn iban_mod97_ok(iban: &str) -> bool {
    let rotated = iban[4..].chars().chain(iban[..4].chars());
    let mut rem: u32 = 0;
    for c in rotated {
        let Some(d) = c.to_digit(36) else {
            return false;
        };
        rem = if d >= 10 {
            (rem * 100 + d) % 97
        } else {
            (rem * 10 + d) % 97
        };
    }
    rem == 1
}

fn normalize_iban(raw: &str) -> Result<String, BankAccountError> {
    let s: String = raw
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_uppercase();
    let b = s.as_bytes();
    let shape_ok = (15..=34).contains(&b.len())
        && b[..2].iter().all(u8::is_ascii_uppercase)
        && b[2..4].iter().all(u8::is_ascii_digit)
        && b[4..]
            .iter()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit());
    if !shape_ok || !iban_mod97_ok(&s) {
        return Err(err("iban", "is not a valid IBAN"));
    }
    Ok(s)
}

fn normalize_account_number(raw: &str) -> Result<String, BankAccountError> {
    let s: String = raw
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .collect::<String>()
        .to_uppercase();
    let ok = (1..=34).contains(&s.len())
        && s.bytes()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit());
    if !ok {
        return Err(err("account_number", "is not a valid account number"));
    }
    Ok(s)
}

fn normalize_bic(raw: &str) -> Result<String, BankAccountError> {
    let s = raw.to_uppercase();
    let b = s.as_bytes();
    let ok = (b.len() == 8 || b.len() == 11)
        && b[..6].iter().all(u8::is_ascii_uppercase)
        && b[6..]
            .iter()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit());
    if !ok {
        return Err(err("swift_bic_code", "is not a valid SWIFT/BIC code"));
    }
    Ok(s)
}

fn normalize_routing(raw: &str) -> Result<String, BankAccountError> {
    let digits: Vec<u32> = raw.chars().filter_map(|c| c.to_digit(10)).collect();
    if raw.chars().count() != 9 || digits.len() != 9 {
        return Err(err("routing_number", "is not a valid routing number"));
    }
    let sum = 3 * (digits[0] + digits[3] + digits[6])
        + 7 * (digits[1] + digits[4] + digits[7])
        + (digits[2] + digits[5] + digits[8]);
    if !sum.is_multiple_of(10) {
        return Err(err("routing_number", "is not a valid routing number"));
    }
    Ok(raw.to_owned())
}

pub fn normalize(
    input: &SettlementBankAccountInput,
) -> Result<SettlementBankAccount, BankAccountError> {
    let account_holder_name = required(
        input.account_holder_name.as_deref(),
        "account_holder_name",
        NAME_MAX_CHARS,
    )?;
    let bank_name = required(input.bank_name.as_deref(), "bank_name", NAME_MAX_CHARS)?;
    let bank_address = match clean(input.bank_address.as_deref()) {
        Some(a) if a.chars().count() > ADDRESS_MAX_CHARS => {
            return Err(err("bank_address", "is too long"));
        }
        other => other,
    };
    let iban = clean(input.iban.as_deref())
        .map(|v| normalize_iban(&v))
        .transpose()?;
    let account_number = clean(input.account_number.as_deref())
        .map(|v| normalize_account_number(&v))
        .transpose()?;
    if iban.is_none() && account_number.is_none() {
        return Err(err("account_number", "or iban is required"));
    }
    let swift_bic_code = clean(input.swift_bic_code.as_deref())
        .map(|v| normalize_bic(&v))
        .transpose()?;
    let routing_number = clean(input.routing_number.as_deref())
        .map(|v| normalize_routing(&v))
        .transpose()?;
    if swift_bic_code.is_none() && routing_number.is_none() {
        return Err(err("swift_bic_code", "or routing_number is required"));
    }
    Ok(SettlementBankAccount {
        account_holder_name,
        bank_name,
        bank_address,
        account_number,
        iban,
        swift_bic_code,
        routing_number,
    })
}

pub fn account_last4(account: &SettlementBankAccount) -> Option<String> {
    let id = account.iban.as_ref().or(account.account_number.as_ref())?;
    let chars: Vec<char> = id
        .chars()
        .filter(|c| !c.is_whitespace())
        .flat_map(char::to_uppercase)
        .collect();
    if chars.len() <= 4 {
        return None;
    }
    Some(chars[chars.len() - 4..].iter().collect())
}
