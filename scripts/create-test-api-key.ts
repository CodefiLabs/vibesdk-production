/**
 * Script to create a test API key
 * Run with: npx tsx scripts/create-test-api-key.ts
 */

import { generateId } from '../worker/utils/idGenerator';
import { sha256 } from '../worker/utils/cryptoUtils';

async function createTestApiKey() {
	// Generate secure random API key
	const randomBytes = new Uint8Array(32);
	crypto.getRandomValues(randomBytes);
	const apiKey = 'vsk_' + Array.from(randomBytes)
		.map(b => b.toString(16).padStart(2, '0'))
		.join('');

	// Hash for storage
	const apiKeyHash = await sha256(apiKey);

	// Create preview
	const keyPreview = apiKey.slice(0, 12) + '...';

	console.log('\n=== API Key Created ===');
	console.log('Raw API Key (save this!):', apiKey);
	console.log('Key Hash:', apiKeyHash);
	console.log('Key Preview:', keyPreview);
	console.log('\nManually insert into database:');
	console.log(`
INSERT INTO api_keys (id, user_id, name, key_hash, key_preview, scopes, is_active, created_at, updated_at)
VALUES (
  '${generateId()}',
  'YOUR_USER_ID_HERE',
  'Test API Key',
  '${apiKeyHash}',
  '${keyPreview}',
  '[]',
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);
	`);
}

createTestApiKey();
