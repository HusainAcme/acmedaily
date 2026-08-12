// Shared, framework-free source + category definitions.
// Imported by both the browser app (src/App.jsx) and the Node prefetch
// script (scripts/fetch-feeds.mjs), so the two can never drift apart.

export const CATEGORIES = [
  { id: "all", label: "All News", icon: "📰", color: "#0d0d0d" },
  { id: "ai", label: "AI & LLMs", icon: "🤖", color: "#10a37f" },
  { id: "microsoft", label: "Microsoft", icon: "⊞", color: "#0078d4" },
  { id: "cloud", label: "Cloud", icon: "☁", color: "#ff9900" },
  { id: "devops", label: "DevOps", icon: "⚙", color: "#ff6b35" },
  { id: "enterprise", label: "Enterprise", icon: "🏢", color: "#607d8b" },
  { id: "security", label: "Security", icon: "🔐", color: "#cc0000" },
];

export const SOURCES = [
  // AI & LLMs
  { id: "openai", cat: "ai", label: "OpenAI", short: "OAI", url: "https://openai.com/blog/rss.xml", color: "#10a37f", bg: "#e8f7f3", domain: "openai.com" },
  { id: "anthropic", cat: "ai", label: "Anthropic", short: "AC", url: "https://www.anthropic.com/news", isHtml: true, color: "#b05c2a", bg: "#f7ede5", domain: "anthropic.com" },
  { id: "vergeai", cat: "ai", label: "The Verge AI", short: "VG", url: "https://www.theverge.com/rss/index.xml", color: "#e5192b", bg: "#fdeaeb", domain: "theverge.com" },
  { id: "tcai", cat: "ai", label: "TechCrunch AI", short: "TC", url: "https://techcrunch.com/category/artificial-intelligence/feed/", color: "#0a8f08", bg: "#e7f4e7", domain: "techcrunch.com" },
  { id: "nvidia", cat: "ai", label: "Nvidia", short: "NV", url: "https://blogs.nvidia.com/feed/", color: "#76b900", bg: "#eef7e6", domain: "nvidia.com" },
  // Microsoft
  { id: "msai", cat: "microsoft", label: "Microsoft AI", short: "MS", url: "https://blogs.microsoft.com/ai/feed/", color: "#0078d4", bg: "#e5f2fc", domain: "microsoft.com" },
  { id: "azure", cat: "microsoft", label: "Azure", short: "AZ", url: "https://azure.microsoft.com/en-us/blog/feed/", color: "#0089d6", bg: "#e5f2fc", domain: "azure.microsoft.com" },
  { id: "github", cat: "microsoft", label: "GitHub", short: "GH", url: "https://github.blog/all.atom", color: "#24292f", bg: "#f0f0f0", domain: "github.com" },
  { id: "m365", cat: "microsoft", label: "M365 / Copilot", short: "M3", url: "https://www.microsoft.com/en-us/microsoft-365/blog/feed/", color: "#5c2d91", bg: "#f0eaf8", domain: "microsoft.com" },
  // Cloud
  { id: "aws", cat: "cloud", label: "AWS", short: "AWS", url: "https://aws.amazon.com/blogs/aws/feed/", color: "#ff9900", bg: "#fff5e5", domain: "aws.amazon.com" },
  { id: "gcloud", cat: "cloud", label: "Google Cloud", short: "GC", url: "https://feeds.feedburner.com/GoogleCloudPlatformBlog", color: "#4285f4", bg: "#eaf1ff", domain: "cloud.google.com" },
  { id: "awssec", cat: "cloud", label: "AWS Security", short: "AWSs", url: "https://aws.amazon.com/blogs/security/feed/", color: "#e8691c", bg: "#fff0e8", domain: "aws.amazon.com" },
  // DevOps
  { id: "devopsdotcom", cat: "devops", label: "DevOps.com", short: "DO", url: "https://devops.com/feed/", color: "#ff6b35", bg: "#fff0ea", domain: "devops.com" },
  { id: "thenewstack", cat: "devops", label: "The New Stack", short: "NS", url: "https://thenewstack.io/feed/", color: "#1a1a2e", bg: "#eaeaf3", domain: "thenewstack.io" },
  { id: "docker", cat: "devops", label: "Docker", short: "DK", url: "https://www.docker.com/blog/feed/", color: "#2496ed", bg: "#e8f3fc", domain: "docker.com" },
  { id: "redhat", cat: "devops", label: "Red Hat", short: "RH", url: "https://www.redhat.com/en/rss/blog", color: "#cc0000", bg: "#fdeaea", domain: "redhat.com" },
  // Enterprise
  { id: "cisco", cat: "enterprise", label: "Cisco", short: "CS", url: "https://blogs.cisco.com/feed", color: "#049fd9", bg: "#e5f6fd", domain: "cisco.com" },
  { id: "adobe", cat: "enterprise", label: "Adobe", short: "AD", url: "https://blog.adobe.com/en/publish/feed.xml", color: "#fa0f00", bg: "#fde8e8", domain: "adobe.com" },
  { id: "hpe", cat: "enterprise", label: "HPE", short: "HP", url: "https://hnrss.org/newest?q=Hewlett+Packard+Enterprise", color: "#01a982", bg: "#e5f7f3", domain: "hpe.com" },
  { id: "veeam", cat: "enterprise", label: "Veeam", short: "VM", url: "https://www.veeam.com/blog/feed/", color: "#007db8", bg: "#e5f2f9", domain: "veeam.com" },
  // Security
  { id: "paloalto", cat: "security", label: "Palo Alto", short: "PA", url: "https://www.paloaltonetworks.com/blog/feed/", color: "#fa582d", bg: "#fff0eb", domain: "paloaltonetworks.com" },
  { id: "fortinet", cat: "security", label: "Fortinet", short: "FT", url: "https://www.fortinet.com/blog/rss.xml", color: "#ee3124", bg: "#fdecea", domain: "fortinet.com" },
  { id: "krebs", cat: "security", label: "Krebs on Security", short: "KB", url: "https://krebsonsecurity.com/feed/", color: "#333", bg: "#f0f0f0", domain: "krebsonsecurity.com" },
];

export const SOURCE_BY_ID = Object.fromEntries(SOURCES.map(s => [s.id, s]));

// How often the scheduled workflow regenerates feeds.json, in minutes.
// Kept here so the UI's "next update" countdown and the cron stay in sync.
export const REFRESH_INTERVAL_MINUTES = 30;

// Data older than this is surfaced to the reader as stale — it means the
// scheduled job has missed at least two runs.
export const STALE_AFTER_MINUTES = 90;
