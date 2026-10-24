import {createLoginHandler} from './handler.js';

Deno.serve(createLoginHandler({
    url: Deno.env.get('SUPABASE_URL'),
    publicKey: Deno.env.get('SUPABASE_ANON_KEY'),
    serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    allowedOrigins: (Deno.env.get('JOBTRACKER_ALLOWED_ORIGINS') || '').split(',').map(value => value.trim()).filter(Boolean)
}));
