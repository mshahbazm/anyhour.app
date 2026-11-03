import { expect, test } from 'bun:test'
import { createCitationSelection } from '../../src/services/chat/citations'

test('retrieval candidates are not citations until explicitly selected', () => {
  const selection = createCitationSelection()
  const first = {
    sourceId: 'a',
    title: 'Relevant',
    url: 'https://example.com/a',
  }
  const second = {
    sourceId: 'b',
    title: 'Unused',
    url: 'https://example.com/b',
  }
  selection.register([first, second])
  expect(selection.citations).toEqual([])
  expect(selection.select(['a', 'a']).accepted).toBe(true)
  expect(selection.citations).toEqual([first])
  expect(selection.select(['invented']).accepted).toBe(false)
  expect(selection.citations).toEqual([first])
  selection.select([])
  expect(selection.citations).toEqual([])
})

test('one page served at several addresses is cited once', () => {
  const selection = createCitationSelection()
  const home = {
    sourceId: 'a',
    title: 'A New Way to Sell',
    url: 'https://example.com/',
  }
  const index = {
    sourceId: 'b',
    title: 'A New Way to Sell',
    url: 'https://example.com/index.html',
  }
  const pricing = {
    sourceId: 'c',
    title: 'Pricing',
    url: 'https://example.com/pricing.html',
  }
  selection.register([home, index, pricing])
  selection.select(['a', 'b', 'c'])
  expect(selection.citations).toEqual([home, pricing])
})
