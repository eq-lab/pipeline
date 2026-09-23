//! Failed-sign-in throttle for `POST /v1/auth/login`
//! (`packages/shared/migrations/20260922000002_login_attempts.sql`).
//!
//! Counting happens in one SQL statement per key. A read-then-write version
//! loses the race the limit exists to stop: concurrent attempts all observe the
//! same count and all pass a limit of 3, which is precisely how an attacker
//! would send them.

use sqlx::PgPool;

/// One of the two things a limit is counted against.
#[derive(Debug, Clone, Copy)]
pub enum AttemptScope {
    /// The submitted address — bounds brute force against one account.
    Email,
    /// The client address — bounds credential stuffing across many accounts.
    Ip,
}

impl AttemptScope {
    fn as_str(self) -> &'static str {
        match self {
            AttemptScope::Email => "email",
            AttemptScope::Ip => "ip",
        }
    }
}

pub struct LoginAttemptRepo {
    pub pool: PgPool,
}

impl LoginAttemptRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Record an attempt and return how many have now been made in the current
    /// window, this one included. A window older than `window_secs` restarts at
    /// 1 rather than being cleaned up separately, so an idle key costs nothing.
    pub async fn record(
        &self,
        scope: AttemptScope,
        key: &str,
        window_secs: i32,
    ) -> Result<i32, sqlx::Error> {
        let row: (i32,) = sqlx::query_as(
            "INSERT INTO login_attempts (scope, key, window_start, attempts) \
             VALUES ($1, $2, now(), 1) \
             ON CONFLICT (scope, key) DO UPDATE SET \
               attempts = CASE \
                   WHEN login_attempts.window_start \
                        < now() - make_interval(secs => $3::double precision) THEN 1 \
                   ELSE login_attempts.attempts + 1 END, \
               window_start = CASE \
                   WHEN login_attempts.window_start \
                        < now() - make_interval(secs => $3::double precision) THEN now() \
                   ELSE login_attempts.window_start END \
             RETURNING attempts",
        )
        .bind(scope.as_str())
        .bind(key)
        .bind(window_secs)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.0)
    }

    /// Forget a key's attempts. Called after a successful sign-in so a caller who
    /// mistypes twice and then succeeds is not left one failure from a lockout.
    pub async fn clear(&self, scope: AttemptScope, key: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM login_attempts WHERE scope = $1 AND key = $2")
            .bind(scope.as_str())
            .bind(key)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
