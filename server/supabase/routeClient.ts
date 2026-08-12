// server/supabase/routeClient.ts

import {AsyncLocalStorage} from "node:async_hooks";
import type {SupabaseClient} from "@supabase/supabase-js";
import {createSupabaseServerClient} from "./serverClient";

const routeClientContext=new AsyncLocalStorage<SupabaseClient>();

export function createSupabaseRouteClient(){return routeClientContext.getStore()??createSupabaseServerClient();}
export function runWithSupabaseRouteClient<T>(client:SupabaseClient,operation:()=>Promise<T>):Promise<T>{return routeClientContext.run(client,operation);}
