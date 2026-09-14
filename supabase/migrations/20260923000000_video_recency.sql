-- Workspace list ordering must reflect video progress and transcript updates.
create function learning_private.touch_video_workspace() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.learning_workspaces set updated_at=new.updated_at
 where id=new.workspace_id and user_id=new.user_id;
 return new;
end;
$$;
revoke all on function learning_private.touch_video_workspace() from public,anon,authenticated;
create trigger learning_video_workspace_recency
after update on public.learning_videos
for each row execute function learning_private.touch_video_workspace();
