'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const T = require('../public/dexdiffusion/library-tags.js');
const { sortLibraryIds, libraryImageName } = require('../library-sort.js');

test('names ignore the run timestamp and prefer the imported name', () => {
  assert.equal(libraryImageName('20261103-125955-Controlled-sd15-a.png'), 'controlled-sd15-a.png');
  assert.equal(libraryImageName('20261103-125955-x.png', 'Cabin.PNG'), 'cabin.png');
});

test('sorts: newest, oldest, and natural name order in both directions', () => {
  const ids = ['20260101-000000-b10.png', '20260103-000000-a.png', '20260102-000000-b2.png'];
  const none = () => undefined;
  assert.deepEqual(sortLibraryIds(ids.slice(), 'desc', none)[0], '20260103-000000-a.png');
  assert.deepEqual(sortLibraryIds(ids.slice(), 'asc', none)[0], '20260101-000000-b10.png');
  assert.deepEqual(sortLibraryIds(ids.slice(), 'name-asc', none), ['20260103-000000-a.png', '20260102-000000-b2.png', '20260101-000000-b10.png']);
  assert.deepEqual(sortLibraryIds(ids.slice(), 'name-desc', none), ['20260101-000000-b10.png', '20260102-000000-b2.png', '20260103-000000-a.png']);
});

test('tags are normalised, de-duplicated and removable; an image with no tags leaves the store', () => {
  let s = T.cleanStore(null);
  s = T.addTags(s, 'a', ' Forest,  deep   woods ,forest,, ');
  assert.deepEqual(T.tagsFor(s, 'a'), ['deep woods', 'forest']);
  s = T.addTags(s, 'b', 'forest');
  assert.deepEqual(T.tagCounts(s), [{ tag: 'forest', count: 2 }, { tag: 'deep woods', count: 1 }]);
  assert.deepEqual(T.idsWithAllTags(s, ['forest', 'deep woods']), ['a']);
  s = T.removeTag(T.removeTag(s, 'a', 'forest'), 'a', 'deep woods');
  assert.equal('a' in s.images, false);
});

test('a damaged store is cleaned and stores merge without losing tags', () => {
  assert.deepEqual(T.cleanStore({ images: { a: 'nope', b: [' X ', 7] } }).images, { b: ['7', 'x'] });
  assert.deepEqual(T.mergeStores({ images: { a: ['x'] } }, { images: { a: ['y'], b: ['z'] } }).images, { a: ['x', 'y'], b: ['z'] });
});

test('grouping keeps sort order, repeats multi-tag images under each tag, and names the ungrouped', () => {
  const items = [{ id: '20261103-1-a', meta: { target: 'sd15', operation: 'txt2img' } }, { id: '20261102-1-b', meta: {} }, { id: 'c', meta: { target: 'sd15' } }];
  const store = { images: { '20261103-1-a': ['x', 'y'] } };
  assert.deepEqual(T.groupItems(items, 'none', store), [{ label: '', items }]);
  assert.deepEqual(T.groupItems(items, 'day', store).map(g => g.label), ['2026-11-03', '2026-11-02', 'Undated']);
  assert.deepEqual(T.groupItems(items, 'model', store).map(g => [g.label, g.items.length]), [['sd15', 2], ['Unknown model', 1]]);
  assert.deepEqual(T.groupItems(items, 'tag', store).map(g => [g.label, g.items.length]), [['x', 1], ['y', 1], ['Untagged', 2]]);
});

test('the native app stores tags in one file with the Mac images and only for Studio', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../native/macos/Image_Gen/ImageGenApp.swift'), 'utf8');
  assert.match(src, /homeDirectoryForCurrentUser\.appendingPathComponent\("images_made\/library-tags\.json"\)/);
  assert.doesNotMatch(src, /DexDiffusion\/library-tags\.json/);
  const cli = fs.readFileSync(path.resolve(__dirname, '../../bin/dexdiffusion'), 'utf8');
  assert.match(cli, /grep -v '\^library-tags\\\.json\$'/, 'status must not report the tag file as the latest image');
  assert.match(src, /addScriptMessageHandler\(tagsBridge, contentWorld: \.page, name: "dexLibraryTags"\)/);
  assert.match(src, /removeScriptMessageHandler\(forName: "dexLibraryTags", contentWorld: \.page\)/);
  const bridge = src.slice(src.indexOf('private final class LibraryTagsBridge'), src.indexOf('final class AppDelegate'));
  assert.match(bridge, /origin\.host == "127\.0\.0\.1", origin\.port == 31337/);
  assert.match(bridge, /options: \.atomic/);
});

test('a tag file that was not read is never overwritten', async () => {
  const saved = [];
  let onDisk = '{ corrupt';
  const bridge = { postMessage: async m => { if (m.action === 'load') return onDisk; saved.push(m.text); return true; } };
  const store = { version: 1, images: { a: ['x'] } };
  global.window = { __dexNativeWrapper: true, webkit: { messageHandlers: { dexLibraryTags: bridge } } };
  global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  try {
    await assert.rejects(T.save(store), /left untouched/, 'a tag added before loading finishes must not replace the file');
    for (const bad of ['{ corrupt', '[]', '{"images":"nope"}']) {
      onDisk = bad;
      const result = await T.load();
      assert.equal(result.where, 'unavailable');
      assert.ok(result.error);
      await assert.rejects(T.save(store), /left untouched/);
    }
    assert.deepEqual(saved, []);
    onDisk = '{"version":1,"images":{"b":["y"]}}';
    const good = await T.load();
    assert.equal(good.where, 'mac');
    assert.deepEqual(T.tagsFor(good.store, 'b'), ['y']);
    assert.equal(await T.save(store), 'mac');
    assert.equal(saved.length, 1);
    onDisk = null;
    assert.equal((await T.load()).where, 'mac', 'no file yet is a good read');
  } finally {
    delete global.window;
    delete global.localStorage;
  }
});
