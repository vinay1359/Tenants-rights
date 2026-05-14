import type { SupabaseClient } from '@supabase/supabase-js';
import type { SavedChat } from '@/lib/types';

export async function fetchCloudChats(supabase: SupabaseClient): Promise<SavedChat[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('saved_chats')
    .select('payload, updated_at')
    .order('updated_at', { ascending: false });

  if (error || !data) return [];

  return data.map((row) => row.payload as SavedChat);
}

export async function upsertCloudChat(supabase: SupabaseClient, chat: SavedChat) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from('saved_chats').upsert(
    {
      id: chat.id,
      user_id: user.id,
      payload: chat,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );
}

export async function deleteCloudChat(supabase: SupabaseClient, id: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from('saved_chats').delete().eq('id', id).eq('user_id', user.id);
}
