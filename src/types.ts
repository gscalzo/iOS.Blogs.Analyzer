export interface BlogSite {
	title: string;
	author: string;
	site_url: string;
	feed_url: string;
	bluesky_url?: string;
	github_url?: string;
	linkedin_url?: string;
	mastodon_url?: string;
	microblog_url?: string;
	threads_url?: string;
	twitter_url?: string;
	weibo_url?: string;
}

export interface BlogCategory {
	title: string;
	slug: string;
	description: string;
	sites: BlogSite[];
}

export interface BlogLanguageGroup {
	language: string;
	title: string;
	categories: BlogCategory[];
}

export type BlogsDirectory = BlogLanguageGroup[];

export interface FeedItem {
	title: string;
	link: string;
	description?: string;
	publishedAt?: string;
}

export interface ParsedFeed {
	title?: string;
	description?: string;
	items: FeedItem[];
}

export interface FetchFeedOptions {
	timeoutMs?: number;
	userAgent?: string;
	fetcher?: typeof fetch;
}