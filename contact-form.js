/**
 * contact-form.js
 * 問い合わせフォームのセキュリティ実装
 *
 * - Rate limiting  : localStorage で1時間10回まで（ブラウザ単位）
 * - XSS対策        : 送信前にHTMLエンティティをエスケープ
 * - バリデーション  : 必須チェック・メール形式・文字数制限
 */

(function () {
  'use strict';

  /* ── 定数 ─────────────────────────────── */
  const FORMSPREE_ENDPOINT = 'https://formspree.io/f/xjgjlzaw';
  const RATE_LIMIT_KEY     = 'trim_contact_submissions';
  const RATE_LIMIT_MAX     = 10;            // 最大送信回数
  const RATE_LIMIT_WINDOW  = 60 * 60 * 1000; // 1時間（ミリ秒）
  const MAX_NAME_LEN       = 100;
  const MAX_EMAIL_LEN      = 254;
  const MAX_MSG_LEN        = 5000;

  /* ── DOM ──────────────────────────────── */
  const form        = document.getElementById('contact-form');
  const nameInput   = document.getElementById('name');
  const emailInput  = document.getElementById('email');
  const msgInput    = document.getElementById('message');
  const submitBtn   = document.getElementById('submit-btn');
  const formAlert   = document.getElementById('form-alert');
  const charCounter = document.getElementById('char-counter');

  if (!form) return; // contact.html 以外では何もしない

  /* ──────────────────────────────────────
     XSS 対策: HTML エンティティをエスケープ
  ────────────────────────────────────── */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;')
      .replace(/'/g,  '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  /**
   * ユーザー入力を安全な文字列に正規化する
   * - 前後の空白を除去
   * - HTMLタグを除去（エスケープ後にタグ形式になったものも排除）
   * - 制御文字を除去（改行・タブは保持）
   */
  function sanitize(str) {
    return str
      .trim()
      // NULLバイトや制御文字を除去（改行 \n \r、タブ \t は許可）
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      // HTMLタグを除去
      .replace(/<[^>]*>/g, '');
  }

  /* ──────────────────────────────────────
     バリデーション
  ────────────────────────────────────── */
  function validateEmail(email) {
    // RFC 5322 の簡易チェック
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
  }

  /**
   * 各フィールドを検証し、エラーメッセージの配列を返す。
   * @returns {{ field: string, msg: string }[]}
   */
  function validate(name, email, message) {
    const errors = [];

    if (!name) {
      errors.push({ field: 'name', msg: 'お名前を入力してください。' });
    } else if (name.length > MAX_NAME_LEN) {
      errors.push({ field: 'name', msg: `お名前は${MAX_NAME_LEN}文字以内で入力してください。` });
    }

    if (!email) {
      errors.push({ field: 'email', msg: 'メールアドレスを入力してください。' });
    } else if (!validateEmail(email)) {
      errors.push({ field: 'email', msg: 'メールアドレスの形式が正しくありません。' });
    } else if (email.length > MAX_EMAIL_LEN) {
      errors.push({ field: 'email', msg: 'メールアドレスが長すぎます。' });
    }

    if (!message) {
      errors.push({ field: 'message', msg: 'お問い合わせ内容を入力してください。' });
    } else if (message.length > MAX_MSG_LEN) {
      errors.push({ field: 'message', msg: `お問い合わせ内容は${MAX_MSG_LEN}文字以内で入力してください。` });
    }

    return errors;
  }

  /* ──────────────────────────────────────
     Rate Limiting（localStorage）
     同一ブラウザから1時間に10回まで
  ────────────────────────────────────── */
  function getRateLimitData() {
    try {
      return JSON.parse(localStorage.getItem(RATE_LIMIT_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function saveRateLimitData(timestamps) {
    try {
      localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(timestamps));
    } catch {
      // localStorage が使えない環境では何もしない
    }
  }

  /**
   * 送信を許可するか判定し、許可する場合はタイムスタンプを記録する。
   * @returns {{ allowed: boolean, remaining: number, resetInMinutes: number }}
   */
  function checkRateLimit() {
    const now = Date.now();
    let timestamps = getRateLimitData();

    // 1時間以上前のエントリを除去
    timestamps = timestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW);

    if (timestamps.length >= RATE_LIMIT_MAX) {
      // 最古のエントリからリセットまでの残り時間を計算
      const oldest         = Math.min(...timestamps);
      const resetAt        = oldest + RATE_LIMIT_WINDOW;
      const resetInMinutes = Math.ceil((resetAt - now) / 60000);
      return { allowed: false, remaining: 0, resetInMinutes };
    }

    timestamps.push(now);
    saveRateLimitData(timestamps);

    return {
      allowed:       true,
      remaining:     RATE_LIMIT_MAX - timestamps.length,
      resetInMinutes: 60
    };
  }

  /* ──────────────────────────────────────
     UI ヘルパー
  ────────────────────────────────────── */
  function showAlert(message, type) {
    formAlert.textContent = message; // textContent でXSSを回避
    formAlert.className   = `form__alert form__alert--${type} visible`;
    formAlert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function hideAlert() {
    formAlert.className = 'form__alert';
    formAlert.textContent = '';
  }

  function showFieldError(fieldId, message) {
    const el    = document.getElementById(`${fieldId}-error`);
    const input = document.getElementById(fieldId);
    if (el) {
      el.textContent = message; // textContent でXSSを回避
      el.classList.add('visible');
    }
    if (input) {
      input.classList.add(`form__${input.tagName.toLowerCase() === 'textarea' ? 'textarea' : 'input'}--error`);
      input.setAttribute('aria-invalid', 'true');
    }
  }

  function clearFieldErrors() {
    ['name', 'email', 'message'].forEach(id => {
      const errEl = document.getElementById(`${id}-error`);
      const input = document.getElementById(id);
      if (errEl) {
        errEl.textContent = '';
        errEl.classList.remove('visible');
      }
      if (input) {
        input.classList.remove('form__input--error', 'form__textarea--error');
        input.removeAttribute('aria-invalid');
      }
    });
  }

  function setLoading(loading) {
    submitBtn.disabled = loading;
    submitBtn.classList.toggle('form__button--loading', loading);
  }

  /* ──────────────────────────────────────
     文字数カウンター
  ────────────────────────────────────── */
  msgInput.addEventListener('input', () => {
    const len = msgInput.value.length;
    charCounter.textContent = `${len.toLocaleString()} / ${MAX_MSG_LEN.toLocaleString()}`;
    charCounter.classList.toggle('warn', len > MAX_MSG_LEN * 0.9);
  });

  /* ──────────────────────────────────────
     リアルタイムバリデーション（blur 時）
  ────────────────────────────────────── */
  [nameInput, emailInput, msgInput].forEach(input => {
    input.addEventListener('blur', () => {
      const id    = input.id;
      const value = sanitize(input.value);

      // 該当フィールドのエラーだけクリア
      const errEl = document.getElementById(`${id}-error`);
      if (errEl) {
        errEl.textContent = '';
        errEl.classList.remove('visible');
      }
      input.classList.remove('form__input--error', 'form__textarea--error');
      input.removeAttribute('aria-invalid');

      // 単一フィールドのバリデーション
      const errors = validate(
        id === 'name'    ? value : sanitize(nameInput.value),
        id === 'email'   ? value : sanitize(emailInput.value),
        id === 'message' ? value : sanitize(msgInput.value)
      ).filter(e => e.field === id);

      if (errors.length > 0) {
        showFieldError(id, errors[0].msg);
      }
    });
  });

  /* ──────────────────────────────────────
     フォーム送信処理
  ────────────────────────────────────── */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearFieldErrors();
    hideAlert();

    /* 1. Rate limiting チェック */
    const rate = checkRateLimit();
    if (!rate.allowed) {
      showAlert(
        `送信回数の上限（1時間に${RATE_LIMIT_MAX}回）に達しました。` +
        `約 ${rate.resetInMinutes} 分後に再度お試しください。`,
        'rate-limit'
      );
      return;
    }

    /* 2. 入力値の取得とサニタイズ */
    const rawName    = nameInput.value;
    const rawEmail   = emailInput.value;
    const rawMessage = msgInput.value;

    const name    = sanitize(rawName);
    const email   = sanitize(rawEmail).toLowerCase();
    const message = sanitize(rawMessage);

    /* 3. バリデーション */
    const errors = validate(name, email, message);
    if (errors.length > 0) {
      errors.forEach(e => showFieldError(e.field, e.msg));
      // 最初のエラーフィールドにフォーカス
      const firstField = document.getElementById(errors[0].field);
      if (firstField) firstField.focus();
      return;
    }

    /* 4. 送信（Formspree） */
    setLoading(true);

    try {
      const response = await fetch(FORMSPREE_ENDPOINT, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept':       'application/json'
        },
        body: JSON.stringify({
          name:    escapeHtml(name),
          email:   email,
          message: escapeHtml(message)
        })
      });

      if (response.ok) {
        form.reset();
        charCounter.textContent = `0 / ${MAX_MSG_LEN.toLocaleString()}`;
        showAlert('お問い合わせを受け付けました。2〜3 営業日以内にご返信いたします。', 'success');
      } else {
        const data = await response.json().catch(() => ({}));
        if (data.errors) {
          showAlert('送信に失敗しました。入力内容を確認してもう一度お試しください。', 'error');
        } else {
          showAlert('送信中にエラーが発生しました。しばらくしてから再度お試しください。', 'error');
        }
      }
    } catch {
      showAlert('ネットワークエラーが発生しました。接続を確認してから再度お試しください。', 'error');
    } finally {
      setLoading(false);
    }
  });

})();
