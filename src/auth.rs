use rand::{distr::Alphanumeric, RngExt};

#[derive(Debug, Clone)]
pub struct AdminAuth {
    password: String,
    session_token: String,
}

impl AdminAuth {
    pub fn configured(password: String) -> Self {
        Self {
            password,
            session_token: random_secret(48),
        }
    }

    pub fn generated() -> (Self, String) {
        let password = random_secret(24);
        (Self::configured(password.clone()), password)
    }

    pub fn verify_password(&self, password: &str) -> bool {
        constant_time_eq(self.password.as_bytes(), password.as_bytes())
    }

    pub fn session_token(&self) -> &str {
        &self.session_token
    }

    pub fn verify_session(&self, token: &str) -> bool {
        constant_time_eq(self.session_token.as_bytes(), token.as_bytes())
    }
}

fn random_secret(len: usize) -> String {
    rand::rng()
        .sample_iter(Alphanumeric)
        .take(len)
        .map(char::from)
        .collect()
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }

    left.iter()
        .zip(right.iter())
        .fold(0u8, |acc, (left, right)| acc | (left ^ right))
        == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_configured_password() {
        let auth = AdminAuth::configured("admin-pass".to_string());

        assert!(auth.verify_password("admin-pass"));
        assert!(!auth.verify_password("wrong-pass"));
    }

    #[test]
    fn generated_password_is_returned_for_operator() {
        let (auth, password) = AdminAuth::generated();

        assert!(password.len() >= 24);
        assert!(auth.verify_password(&password));
    }

    #[test]
    fn validates_process_session_token() {
        let auth = AdminAuth::configured("admin-pass".to_string());

        assert!(auth.verify_session(auth.session_token()));
        assert!(!auth.verify_session("other-session"));
    }
}
