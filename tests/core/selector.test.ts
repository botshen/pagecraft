import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isStableId,
  filterSemanticClasses,
  buildSelectorFromChain,
} from '../../lib/picker/selector.ts';

test('isStableId accepts semantic IDs and rejects React/Radix/hash/numeric IDs', () => {
  assert.equal(isStableId('order-table'), true);
  assert.equal(isStableId('mainContent'), true);
  assert.equal(isStableId(':r1a:'), false);
  assert.equal(isStableId('radix-123'), false);
  assert.equal(isStableId('9948271'), false);
  assert.equal(isStableId('a1b2c3d4e5f6a7b8'), false);
});

test('filterSemanticClasses strips CSS-in-JS hashes and utility layout noise', () => {
  const classes = filterSemanticClasses(
    'flex items-center css-1abc2de sc-bdnxRM order-card hover:bg-red-500 product-row',
  );
  assert.deepEqual(classes, ['order-card', 'product-row']);
});

test('buildSelectorFromChain stops at stable #id or [data-testid] anchor', () => {
  const root = { tagName: 'MAIN', id: 'app-main' };
  const section = {
    tagName: 'DIV',
    attributes: { 'data-testid': 'orders-panel' },
    parent: root,
  };
  const table = {
    tagName: 'TABLE',
    className: 'css-998877 data-grid',
    nthOfType: 1,
    parent: section,
  };

  const sel = buildSelectorFromChain(table);
  assert.equal(sel, 'div[data-testid="orders-panel"] > table.data-grid');
});
