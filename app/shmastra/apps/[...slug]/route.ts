import { NextRequest } from "next/server";

// 308 permanent redirect from the legacy /shmastra/apps/<name>[/<path>] path
// to the canonical /apps/<name>[/<path>]. Keeps bookmarks and agent-generated
// markdown links from older chats working without an alias inside Mastra.
//
// More specific than the /shmastra/[[...path]] catch-all in the sibling
// directory, so it intercepts the matching subset.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> },
): Promise<Response> {
  const { slug } = await params;
  const search = new URL(request.url).search;
  const target = `/apps/${slug.map(encodeURIComponent).join("/")}${search}`;
  return Response.redirect(new URL(target, request.url), 308);
}
