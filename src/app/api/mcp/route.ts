import { handleMcp } from '@/server/mcp/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = handleMcp;
export const POST = handleMcp;
export const OPTIONS = handleMcp;
export const DELETE = handleMcp;
