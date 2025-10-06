import { useState, useEffect } from 'react';
import { Key, Copy, Trash2, Plus, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';

interface ApiKey {
	id: string;
	name: string;
	keyPreview: string;
	createdAt: Date | null;
	lastUsed: Date | null;
	isActive: boolean | null;
}

interface NewApiKeyResponse {
	apiKey: string;
	id: string;
	name: string;
	keyPreview: string;
	createdAt: string | null;
	message: string;
}

export function ApiKeysSection() {
	const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
	const [loading, setLoading] = useState(true);
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [newKeyName, setNewKeyName] = useState('');
	const [creating, setCreating] = useState(false);
	const [newlyCreatedKey, setNewlyCreatedKey] = useState<NewApiKeyResponse | null>(null);
	const [showNewKeyDialog, setShowNewKeyDialog] = useState(false);
	const [keyToDelete, setKeyToDelete] = useState<ApiKey | null>(null);
	const [deleting, setDeleting] = useState(false);
	const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

	// Load API keys
	useEffect(() => {
		loadApiKeys();
	}, []);

	const loadApiKeys = async () => {
		try {
			setLoading(true);
			const response = await apiClient.getApiKeys();
			if (response.success && response.data) {
				setApiKeys(response.data.apiKeys);
			}
		} catch (error) {
			console.error('Failed to load API keys:', error);
			toast.error('Failed to load API keys');
		} finally {
			setLoading(false);
		}
	};

	const handleCreateKey = async () => {
		if (!newKeyName.trim()) {
			toast.error('Please enter a name for the API key');
			return;
		}

		try {
			setCreating(true);
			const response = await apiClient.createApiKey({ name: newKeyName.trim() });

			if (response.success && response.data) {
				setNewlyCreatedKey(response.data);
				setShowNewKeyDialog(true);
				setCreateDialogOpen(false);
				setNewKeyName('');
				await loadApiKeys();
				toast.success('API key created successfully');
			}
		} catch (error: any) {
			console.error('Failed to create API key:', error);
			toast.error(error.message || 'Failed to create API key');
		} finally {
			setCreating(false);
		}
	};

	const handleDeleteKey = async () => {
		if (!keyToDelete) return;

		try {
			setDeleting(true);
			const response = await apiClient.revokeApiKey(keyToDelete.id);

			if (response.success) {
				await loadApiKeys();
				toast.success('API key revoked successfully');
				setKeyToDelete(null);
			}
		} catch (error: any) {
			console.error('Failed to delete API key:', error);
			toast.error(error.message || 'Failed to revoke API key');
		} finally {
			setDeleting(false);
		}
	};

	const copyToClipboard = async (text: string, keyId: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopiedKeyId(keyId);
			toast.success('Copied to clipboard');
			setTimeout(() => setCopiedKeyId(null), 2000);
		} catch (error) {
			toast.error('Failed to copy to clipboard');
		}
	};

	const formatDate = (date: Date | null) => {
		if (!date) return 'Never';
		const dateObj = date instanceof Date ? date : new Date(date);
		return dateObj.toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
		});
	};

	return (
		<Card id="api-keys">
			<CardHeader variant="minimal">
				<div className="flex items-center justify-between border-b w-full py-3 text-text-primary">
					<div className="flex items-center gap-3">
						<Key className="h-5 w-5" />
						<div>
							<CardTitle>API Keys</CardTitle>
							<p className="text-sm text-text-tertiary font-normal mt-1">
								Manage API keys for programmatic access to VibeSDK
							</p>
						</div>
					</div>
					<Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
						<DialogTrigger asChild>
							<Button size="sm" className="gap-2">
								<Plus className="h-4 w-4" />
								Create API Key
							</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Create New API Key</DialogTitle>
								<DialogDescription>
									Create a new API key for programmatic access to the VibeSDK API.
									The key will only be shown once.
								</DialogDescription>
							</DialogHeader>
							<div className="space-y-4 py-4">
								<div className="space-y-2">
									<Label htmlFor="keyName">Key Name</Label>
									<Input
										id="keyName"
										placeholder="e.g., Production API Key"
										value={newKeyName}
										onChange={(e) => setNewKeyName(e.target.value)}
										onKeyDown={(e) => {
											if (e.key === 'Enter') {
												handleCreateKey();
											}
										}}
									/>
									<p className="text-xs text-text-tertiary">
										Give your API key a descriptive name to help you identify it later.
									</p>
								</div>
							</div>
							<DialogFooter>
								<Button
									variant="outline"
									onClick={() => {
										setCreateDialogOpen(false);
										setNewKeyName('');
									}}
									disabled={creating}
								>
									Cancel
								</Button>
								<Button onClick={handleCreateKey} disabled={creating}>
									{creating ? 'Creating...' : 'Create Key'}
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				</div>
			</CardHeader>
			<CardContent className="space-y-4 mt-4 px-6">
				{loading ? (
					<div className="flex items-center gap-3 py-8">
						<Key className="h-5 w-5 animate-pulse text-text-tertiary" />
						<span className="text-sm text-text-tertiary">Loading API keys...</span>
					</div>
				) : apiKeys.length === 0 ? (
					<div className="text-center py-8 border-2 border-dashed dark:border-bg-4 rounded-lg">
						<Key className="h-8 w-8 text-text-tertiary mx-auto mb-2" />
						<p className="text-sm text-text-tertiary mb-2">No API keys yet</p>
						<p className="text-xs text-text-tertiary">
							Create an API key to access the VibeSDK API programmatically
						</p>
					</div>
				) : (
					<div className="space-y-3">
						{apiKeys.map((key) => (
							<div
								key={key.id}
								className="flex items-center justify-between p-4 border dark:border-bg-4 rounded-lg hover:bg-bg-2 transition-colors"
							>
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2">
										<h4 className="font-medium text-sm">{key.name}</h4>
										{key.isActive ? (
											<span className="text-xs px-2 py-0.5 bg-green-500/10 text-green-500 rounded">
												Active
											</span>
										) : (
											<span className="text-xs px-2 py-0.5 bg-red-500/10 text-red-500 rounded">
												Revoked
											</span>
										)}
									</div>
									<div className="flex items-center gap-4 mt-1 text-xs text-text-tertiary">
										<span className="font-mono">{key.keyPreview}</span>
										<span>Created {formatDate(key.createdAt)}</span>
										<span>Last used {formatDate(key.lastUsed)}</span>
									</div>
								</div>
								<div className="flex items-center gap-2">
									<Button
										variant="ghost"
										size="sm"
										onClick={() => copyToClipboard(key.keyPreview, key.id)}
										className="gap-2"
									>
										{copiedKeyId === key.id ? (
											<CheckCircle2 className="h-4 w-4 text-green-500" />
										) : (
											<Copy className="h-4 w-4" />
										)}
									</Button>
									<Button
										variant="ghost"
										size="sm"
										onClick={() => setKeyToDelete(key)}
										disabled={!key.isActive}
										className="gap-2 text-red-500 hover:text-red-600 hover:bg-red-500/10"
									>
										<Trash2 className="h-4 w-4" />
									</Button>
								</div>
							</div>
						))}
					</div>
				)}

				<div className="mt-4 p-4 bg-blue-500/5 border border-blue-500/20 rounded-lg">
					<div className="flex gap-2">
						<AlertCircle className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
						<div className="text-xs text-text-tertiary space-y-1">
							<p className="font-medium text-text-secondary">API Key Usage</p>
							<p>
								Use your API key in the Authorization header:{' '}
								<code className="text-xs bg-bg-3 px-1 py-0.5 rounded">
									Authorization: Bearer vsk_...
								</code>
							</p>
							<p className="mt-2">
								Documentation:{' '}
								<a
									href="https://docs.claude.com"
									target="_blank"
									rel="noopener noreferrer"
									className="text-blue-500 hover:underline"
								>
									API Reference
								</a>
							</p>
						</div>
					</div>
				</div>
			</CardContent>

			{/* New Key Display Dialog */}
			<Dialog open={showNewKeyDialog} onOpenChange={setShowNewKeyDialog}>
				<DialogContent className="max-w-2xl">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<CheckCircle2 className="h-5 w-5 text-green-500" />
							API Key Created Successfully
						</DialogTitle>
						<DialogDescription>
							Save this API key now. You won't be able to see it again!
						</DialogDescription>
					</DialogHeader>
					{newlyCreatedKey && (
						<div className="space-y-4 py-4">
							<div className="space-y-2">
								<Label>API Key</Label>
								<div className="flex gap-2">
									<Input
										readOnly
										value={newlyCreatedKey.apiKey}
										className="font-mono text-sm"
									/>
									<Button
										variant="outline"
										onClick={() =>
											copyToClipboard(newlyCreatedKey.apiKey, 'new-key')
										}
										className="gap-2 shrink-0"
									>
										{copiedKeyId === 'new-key' ? (
											<>
												<CheckCircle2 className="h-4 w-4" />
												Copied
											</>
										) : (
											<>
												<Copy className="h-4 w-4" />
												Copy
											</>
										)}
									</Button>
								</div>
							</div>

							<div className="p-4 bg-yellow-500/5 border border-yellow-500/20 rounded-lg">
								<div className="flex gap-2">
									<AlertCircle className="h-4 w-4 text-yellow-500 mt-0.5 shrink-0" />
									<div className="text-xs text-text-tertiary space-y-1">
										<p className="font-medium text-text-secondary">
											Important Security Notice
										</p>
										<p>
											Store this API key securely. It provides full access to your
											VibeSDK account and cannot be recovered if lost.
										</p>
										<p className="mt-2">
											• Never commit API keys to version control
											<br />
											• Store keys in environment variables
											<br />
											• Rotate keys regularly for security
											<br />• Revoke keys immediately if compromised
										</p>
									</div>
								</div>
							</div>
						</div>
					)}
					<DialogFooter>
						<Button
							onClick={() => {
								setShowNewKeyDialog(false);
								setNewlyCreatedKey(null);
							}}
						>
							I've Saved My Key
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete Confirmation Dialog */}
			<AlertDialog open={!!keyToDelete} onOpenChange={() => setKeyToDelete(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Revoke API Key?</AlertDialogTitle>
						<AlertDialogDescription>
							This will permanently revoke the API key "{keyToDelete?.name}". Any
							applications using this key will immediately lose access.
							<br />
							<br />
							This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDeleteKey}
							disabled={deleting}
							className="bg-red-500 hover:bg-red-600"
						>
							{deleting ? 'Revoking...' : 'Revoke Key'}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Card>
	);
}
