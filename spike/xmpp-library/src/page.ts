// DOM helpers shared by the two smoke pages.

export interface FormValues {
  url: string;
  domain: string;
  user: string;
  password: string;
}

function input(name: string): string {
  const el = document.querySelector(`[name="${name}"]`);
  return el instanceof HTMLInputElement ? el.value : '';
}

export function readForm(): FormValues {
  return { url: input('url'), domain: input('domain'), user: input('user'), password: input('password') };
}

export function show(text: string): void {
  const out = document.querySelector('output');
  if (out) out.textContent = text;
}
