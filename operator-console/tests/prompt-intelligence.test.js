'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const { PROFILES, resolvePromptProfile } = require('../prompt-profiles.js');

test('Ollama uses the managed loopback tunnel and never starts an unmanaged SSH forward', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /process\.env\.OLLAMA_BASE_URL\s*\|\|\s*process\.env\.OLLAMA_HOST\s*\|\|\s*'http:\/\/127\.0\.0\.1:11436'/);
  assert.doesNotMatch(server, /11435/);
  assert.doesNotMatch(server, /execFileSync\(['"]ssh['"]\s*,\s*\[[^\]]*-L/s);

  const client = fs.readFileSync(path.join(__dirname, '..', 'public/dexdiffusion/component.js'), 'utf8');
  assert.match(client, /const enhanced = d\.enhanced_prompt \|\| d\.prompt \|\| d\.enhanced/);
  assert.match(client, /original: d\.original_prompt \|\| d\.original \|\| prompt/);
  assert.match(client, /suggested_settings: d\.setting_suggestions \|\| d\.suggested_settings/);
});
const {
  extractProtectedLiterals,
  validateProtectedLiterals,
  buildEnhancementPrompt,
  enhancePrompt,
} = require('../prompt-enhancement.js');

test('profiles: resolves correct profile across image families and custom targets', () => {
  assert.equal(resolvePromptProfile({ target: 'flux2-klein-4b' }).id, 'image.flux2');
  assert.equal(resolvePromptProfile({ target: 'flux-fp8' }).id, 'image.flux1');
  assert.equal(resolvePromptProfile({ target: 'sdxl-turbo' }).id, 'image.sdxl_turbo');
  assert.equal(resolvePromptProfile({ target: 'pony_diffusion_v6_xl' }).id, 'image.pony');
  assert.equal(resolvePromptProfile({ target: 'v1-5-pruned-emaonly' }).id, 'image.sd15');
  assert.equal(resolvePromptProfile({ target: 'photonic_fusion_sdxl_finale_v1' }).id, 'image.sdxl');
  assert.equal(resolvePromptProfile({ target: 'juggernaut_xl_ragnarok' }).id, 'image.sdxl');
});

test('profiles: resolves audio, music, video, and detailer operations', () => {
  assert.equal(resolvePromptProfile({ modality: 'voice', generatorId: 'kokoro' }).id, 'voice.kokoro');
  assert.equal(resolvePromptProfile({ modality: 'voice', generatorId: 'qwen-tts' }).id, 'voice.qwen_tts_base');
  assert.equal(resolvePromptProfile({ modality: 'voice', operation: 'voice_design' }).id, 'voice.qwen_voicedesign');
  assert.equal(resolvePromptProfile({ modality: 'music', generatorId: 'ace-step' }).id, 'music.ace_step');
  assert.equal(resolvePromptProfile({ modality: 'music', generatorId: 'magenta-rt' }).id, 'music.magenta_rt');
  assert.equal(resolvePromptProfile({ modality: 'video' }).id, 'video.ltx');
  assert.equal(resolvePromptProfile({ operation: 'detail_face' }).id, 'detailer.face');
  assert.equal(resolvePromptProfile({ operation: 'detail_hand' }).id, 'detailer.hand');
  assert.equal(resolvePromptProfile({ operation: 'detail_person' }).id, 'detailer.person');
});

test('protected literals: extracts wildcards, LoRAs, quotes, Pony tags, embeddings, and lyric tags', () => {
  const text = 'a photo of __character/hero__ with <lora:EmberPony:0.8> and "holding a glowing sword" score_9, score_8_up, rating_safe embedding:EasyNegative [Verse] singing loudly';
  const lits = extractProtectedLiterals(text);
  assert.ok(lits.includes('__character/hero__'), 'wildcard extracted');
  assert.ok(lits.includes('<lora:EmberPony:0.8>'), 'lora extracted');
  assert.ok(lits.includes('"holding a glowing sword"'), 'quoted literal extracted');
  assert.ok(lits.includes('score_9'), 'score_9 extracted');
  assert.ok(lits.includes('score_8_up'), 'score_8_up extracted');
  assert.ok(lits.includes('rating_safe'), 'rating_safe extracted');
  assert.ok(lits.includes('embedding:EasyNegative'), 'embedding extracted');
  assert.ok(lits.includes('[Verse]'), 'lyric tag extracted');
});

test('protected literals: validation succeeds when all literals survive and fails when missing', () => {
  const orig = 'photo of __hero__ with <lora:Style:0.75> "exact title"';
  const good = 'masterful detailed photo of __hero__ in a sunlit glade with <lora:Style:0.75> and banner reading "exact title"';
  const bad = 'photo of a brave knight with <lora:Other:0.5> title';

  assert.equal(validateProtectedLiterals(orig, good).ok, true);
  const checkBad = validateProtectedLiterals(orig, bad);
  assert.equal(checkBad.ok, false);
  assert.ok(checkBad.missing.includes('__hero__'));
  assert.ok(checkBad.missing.includes('<lora:Style:0.75>'));
  assert.ok(checkBad.missing.includes('"exact title"'));
});

test('prompt enhancement: structured output parsing, settings separation, and keep_alive: 0', async () => {
  let capturedPayload = null;
  const mockRequester = async (route, payload) => {
    capturedPayload = payload;
    return {
      ok: true,
      json: {
        message: {
          content: JSON.stringify({
            enhanced_prompt: 'A cinematic high-detail render of a crystal chalice on a mahogany table, morning sunlight __lighting__, dramatic shadows.',
            negative_prompt: '',
            setting_suggestions: {
              width: 1024,
              height: 1024,
              steps: 4,
              cfg_scale: 1.0,
              notes: 'Distilled 4-step FLUX.2 Klein settings'
            },
            notes: 'Enriched environmental lighting while keeping chalice focus'
          })
        }
      }
    };
  };

  const res = await enhancePrompt({
    prompt: 'crystal chalice on table __lighting__',
    target: 'flux2-klein-4b',
    mode: 'balanced',
    ollamaRequester: mockRequester,
    ollamaModel: 'qwen3.8:27b-mlx'
  });

  assert.equal(res.ok, true);
  assert.match(res.enhanced_prompt, /__lighting__/);
  assert.equal(res.negative_prompt, '', 'FLUX.2 negative prompt stripped');
  assert.deepEqual(res.setting_suggestions.steps, 4);
  assert.equal(capturedPayload.keep_alive, 0, 'keep_alive: 0 sent to immediately unload model');
  assert.equal(capturedPayload.think, false, 'think: false sent for fast inference');
});

test('prompt enhancement: malformed JSON returns controlled failure and preserves original prompt', async () => {
  const mockRequester = async () => ({
    ok: true,
    json: {
      message: { content: 'Sorry, I am an AI and cannot format this as JSON.' }
    }
  });

  const res = await enhancePrompt({
    prompt: 'a red apple',
    target: 'flux2-klein-4b',
    ollamaRequester: mockRequester
  });

  assert.equal(res.ok, false);
  assert.match(res.error, /malformed JSON/i);
  assert.equal(res.enhanced_prompt, 'a red apple', 'preserves original text on failure');
});

test('prompt enhancement: altered protected literal fails closed and preserves original prompt', async () => {
  const mockRequester = async () => ({
    ok: true,
    json: {
      message: {
        content: JSON.stringify({
          enhanced_prompt: 'A hero fighting a dragon without the wildcard token',
          negative_prompt: '',
          setting_suggestions: {}
        })
      }
    }
  });

  const res = await enhancePrompt({
    prompt: 'a hero __character__ fighting a dragon',
    target: 'flux2-klein-4b',
    ollamaRequester: mockRequester
  });

  assert.equal(res.ok, false);
  assert.match(res.error, /protected token\(s\) altered or dropped/i);
  assert.ok(res.missing_literals.includes('__character__'));
  assert.equal(res.enhanced_prompt, 'a hero __character__ fighting a dragon');
});

test('browser: successful enhancement is reviewed before Apply, with Cancel and Undo', async (t) => {
  const browserPath = process.env.DEX_BROWSER_PATH || '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
  if (!fs.existsSync(browserPath)) { t.skip('Brave browser unavailable'); return; }
  try {
    const health = await fetch('http://127.0.0.1:31337/api/version', { signal: AbortSignal.timeout(2000) });
    if (!health.ok) { t.skip('supported DexDiffusion service unavailable'); return; }
  } catch { t.skip('supported DexDiffusion service unavailable'); return; }
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ headless: true, executablePath: browserPath });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const requests = [];
    await page.route('**/api/ollama/status', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ models: [{ name: 'qwen3.8:27b-mlx' }] })
    }));
    await page.route('**/api/ollama/enhance', (route) => {
      const body = route.request().postDataJSON();
      requests.push(body);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        ok: true, original_prompt: body.prompt,
        enhanced_prompt: 'A brass lantern under __lighting__ on a snowy porch.',
        negative_prompt: '', setting_suggestions: null, notes: 'Added setting.', profile: 'image.flux2'
      }) });
    });
    await page.goto('http://127.0.0.1:31337/dexdiffusion/');
    const prompt = page.locator('textarea[placeholder="Describe the image. A1111 syntax supported."]').first();
    const original = 'lantern __lighting__';
    await prompt.fill(original);
    assert.equal(await page.getByText('autocomplete:', { exact: false }).count(), 0, 'completed wildcard does not open autocomplete');
    const enhance = page.getByRole('button', { name: /Enhance \(/ }).first();
    await enhance.click();
    await page.getByText('ORIGINAL', { exact: true }).waitFor();
    assert.equal(await prompt.inputValue(), original, 'review does not change editable prompt');
    assert.equal(await page.getByText('ENHANCED', { exact: true }).count(), 1);
    assert.match(await page.locator('body').innerText(), /A brass lantern under __lighting__/);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await prompt.inputValue(), original, 'Cancel keeps original');
    await enhance.click();
    await page.getByText('ENHANCED', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Apply Enhancement' }).click();
    await page.waitForFunction(() => document.querySelector('textarea[placeholder="Describe the image. A1111 syntax supported."]')?.value === 'A brass lantern under __lighting__ on a snowy porch.');
    assert.equal(await prompt.inputValue(), 'A brass lantern under __lighting__ on a snowy porch.');
    await page.getByRole('button', { name: 'Undo Enhance' }).click();
    await page.waitForFunction(() => document.querySelector('textarea[placeholder="Describe the image. A1111 syntax supported."]')?.value === 'lantern __lighting__');
    assert.equal(await prompt.inputValue(), original, 'Undo restores pre-Apply prompt');
    assert.equal(requests.length, 2);
    assert.ok(requests.every((request) => request.save_prompts === false));
    const geometry = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
    assert.ok(geometry.scrollWidth <= geometry.innerWidth, `mobile page overflow: ${JSON.stringify(geometry)}`);
    assert.ok(await page.locator('[data-v="1"] aside nav [data-nav]').first().isVisible(), 'mobile screen navigation visible');
  } finally {
    await browser.close();
  }
});
