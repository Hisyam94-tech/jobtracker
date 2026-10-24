import {createAddUserHandler} from './handler.js';
Deno.serve(createAddUserHandler({
    url:Deno.env.get('SUPABASE_URL'),
    publicKey:Deno.env.get('SUPABASE_ANON_KEY'),
    serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    allowedOrigins:(Deno.env.get('JOBTRACKER_ALLOWED_ORIGINS') || '').split(',').map(value=>value.trim()).filter(Boolean),
    redirectUrl:Deno.env.get('JOBTRACKER_INVITE_REDIRECT_URL')
}));
