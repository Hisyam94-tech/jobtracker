import {ApiError} from './auth.js';
export const PAGE_SIZE = 50;
const TABLES = {orders: 'jobtracker_repair_orders', parts: 'jobtracker_spare_parts'};
const ORDER_COLUMNS = 'id,company_id,order_number,customer_name,phone,device,status,estimated_cost,date_received,end_date,created_at,updated_at';
const PART_COLUMNS = 'id,company_id,part_number,part_name,quantity,unit_price,min_quantity,category,created_at,updated_at';
export class Repository {
    constructor(auth) { this.auth = auth; }
    async request(resource, params = {}, options = {}) {
        const query = new URLSearchParams(params).toString();
        const epoch = this.auth.epoch;
        try {
            const result = await this.auth.request('/rest/v1/' + resource + (query ? '?' + query : ''), {...options, token: await this.auth.token()});
            if (epoch !== this.auth.epoch) throw new ApiError('The session changed.', 401);
            return result;
        } catch (error) {
            if (error.status === 401 && epoch === this.auth.epoch) this.auth.clear();
            throw error;
        }
    }
    async context(signal) {
        const user = this.auth.session.user.id;
        const [memberships, profiles] = await Promise.all([
            this.request('jobtracker_company_memberships', {select: 'company_id,role,status,company:jobtracker_companies(id,name,status,invoice_template,updated_at)', user_id: 'eq.' + user, order: 'created_at.asc,company_id.asc', limit: 101}, {signal}),
            this.request('jobtracker_profiles', {select: 'user_id,display_name,phone,updated_at', user_id: 'eq.' + user, limit: 1}, {signal})
        ]);
        if (memberships.length > 100) throw new Error('This account has more than 100 company memberships. Contact your administrator.');
        return {memberships, profile: profiles[0] || null};
    }
    isUserAdmin(signal) {
        return this.request('rpc/jobtracker_is_user_admin', {}, {method:'POST',body:{},signal});
    }
    async adminCompanies(cursor, signal) {
        const rows = await this.request('rpc/jobtracker_admin_companies', {}, {method:'POST',body:{after_id:cursor || null},signal});
        return {rows:rows.slice(0,25),hasNext:rows.length > 25};
    }
    async addUser(payload, signal) {
        const epoch=this.auth.epoch;
        const result=await this.auth.request('/functions/v1/jobtracker-add-user', {method:'POST',body:payload,
            token:await this.auth.token(),signal,timeoutMs:30000});
        if (epoch!==this.auth.epoch) throw new ApiError('The session changed.',401);
        return result;
    }
    createCompany(companyName, name, template) {
        return this.request('rpc/jobtracker_create_company', {}, {method: 'POST', body: {company_name: companyName, display_name: name, template_key: template}});
    }
    updateCompany(company, name, template) {
        return this.request('rpc/jobtracker_update_company', {}, {method: 'POST', body: {target_company_id: company.id, company_name: name, template_key: template, expected_updated_at: company.updated_at}});
    }
    async company(id, signal) {
        const rows = await this.request('jobtracker_companies', {select: 'id,name,invoice_template,status,updated_at', id: 'eq.' + id, limit: 1}, {signal});
        if (!rows.length) throw new Error('This company is no longer available to your account.');
        return rows[0];
    }
    async list(kind, company, {search = '', status = '', cursor = null, signal} = {}) {
        if (!TABLES[kind]) throw new Error('Unknown record type.');
        if (!/^[\p{L}\p{N}\s@._+\-]{0,60}$/u.test(search)) throw new Error('Search accepts up to 60 letters, numbers, spaces, @, dots, +, - and underscores.');
        const params = {select: kind === 'orders' ? ORDER_COLUMNS : PART_COLUMNS, company_id: 'eq.' + company, order: 'created_at.desc,id.desc', limit: PAGE_SIZE + 1};
        const clauses = [];
        if (search) {
            const fields = kind === 'orders' ? ['order_number', 'customer_name', 'device'] : ['part_number', 'part_name', 'category'];
            clauses.push('or(' + fields.map(field => field + '.ilike.' + search + '*').join(',') + ')');
        }
        if (status && kind === 'orders') params.status = 'eq.' + status;
        if (cursor) {
            if (!/^[0-9T:.+ Z\-]+$/.test(cursor.created_at) || !/^[a-f0-9-]{36}$/i.test(cursor.id)) throw new Error('Invalid page cursor.');
            clauses.push('or(created_at.lt.' + cursor.created_at + ',and(created_at.eq.' + cursor.created_at + ',id.lt.' + cursor.id + '))');
        }
        if (clauses.length) params.and = '(' + clauses.join(',') + ')';
        const rows = await this.request(TABLES[kind], params, {signal});
        return {rows: rows.slice(0, PAGE_SIZE), hasNext: rows.length > PAGE_SIZE};
    }
    async customers(company, {search = '', field = 'customer_name', cursor = null, signal} = {}) {
        if (!['customer_name','phone','email'].includes(field) || search.length > 100) throw new Error('Invalid customer search.');
        const rows = await this.request('rpc/jobtracker_list_customers', {}, {method:'POST', signal, body:{
            target_company_id:company, search_field:field, search_text:search,
            before_created:cursor?.created_at || null, before_id:cursor?.id || null}});
        return {rows:rows.slice(0,25), hasNext:rows.length > 25};
    }
    async saveCustomer(company, payload, record, signal) {
        const params = {select:'id,company_id,customer_name,phone,email,address,created_at,updated_at'};
        if (record) Object.assign(params, {company_id:'eq.'+company, id:'eq.'+record.id, updated_at:'eq.'+record.updated_at});
        const rows = await this.request('jobtracker_customers', params, {method:record?'PATCH':'POST', signal,
            headers:{Prefer:'return=representation'}, body:record?payload:{...payload,company_id:company}});
        if (!rows?.length) throw new Error('This customer changed or access was removed. Close and reopen the form before saving.');
        return rows[0];
    }
    async repairSuggestions(company, field, search, signal) {
        if (!['customer_name', 'phone', 'device'].includes(field)) throw new Error('Unknown suggestion field.');
        search = search.trim();
        if (search.length < 2) return [];
        if (search.length > 100) throw new Error('Search is too long.');
        return this.request(field === 'device' ? 'rpc/jobtracker_repair_suggestions' : 'rpc/jobtracker_customer_suggestions', {}, {method: 'POST', signal,
            body: {target_company_id: company, search_field: field, search_text: search}});
    }
    async detail(kind, company, id, signal) {
        const rows = await this.request(TABLES[kind], {select: '*', company_id: 'eq.' + company, id: 'eq.' + id, limit: 1}, {signal});
        if (!rows.length) throw new Error('This record is no longer available. Refresh the list.');
        return rows[0];
    }
    count(kind, company, status, signal) {
        const params = {select: 'id', company_id: 'eq.' + company, limit: 1};
        if (status) params.status = 'eq.' + status;
        return this.request(TABLES[kind], params, {signal, headers: {Prefer: 'count=exact'}, returnCount: true});
    }
    async overview(company, signal) {
        const [total, inProgress, completed, parts] = await Promise.all([
            this.count('orders', company, '', signal), this.count('orders', company, 'in-progress', signal),
            this.count('orders', company, 'completed', signal), this.count('parts', company, '', signal)
        ]);
        return {total, inProgress, completed, parts};
    }
    async revenue(company, from, to, signal) {
        const datePattern = /^\d{4}-\d{2}-\d{2}$/;
        const start = Date.parse(from), end = Date.parse(to);
        if (!datePattern.test(from) || !datePattern.test(to) || !Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 30 * 86400000) {
            throw new Error('Choose a report range of up to 31 days.');
        }
        const rows = await this.request(TABLES.orders, {select: 'id,order_number,customer_name,date_received,components_changed',
            company_id: 'eq.' + company, status: 'eq.completed',
            and: `(date_received.gte.${from},date_received.lte.${to})`, order: 'date_received.asc,id.asc', limit: 501}, {signal});
        if (rows.length > 500) throw new Error('More than 500 completed repairs in this range. Choose fewer days to see an accurate total.');
        return rows;
    }
    async updateProfile(user, displayName, expectedUpdatedAt) {
        const rows = await this.request('jobtracker_profiles', {user_id: 'eq.' + user, updated_at: 'eq.' + expectedUpdatedAt, select: 'user_id,display_name,phone,updated_at'},
            {method: 'PATCH', headers: {Prefer: 'return=representation'}, body: {display_name: displayName}});
        if (!rows?.length) throw new Error('Your profile changed. Reload it before saving.');
        return rows[0];
    }
    async save(kind, company, payload, record = null) {
        const params = {select: '*'};
        if (record) Object.assign(params, {company_id: 'eq.' + company, id: 'eq.' + record.id, updated_at: 'eq.' + record.updated_at});
        const rows = await this.request(TABLES[kind], params, {method: record ? 'PATCH' : 'POST',
            headers: {Prefer: 'return=representation'}, body: record ? payload : {...payload, company_id: company}});
        if (!rows?.length) throw new Error('This record changed or your access was removed. Close and reopen it before saving.');
        return rows[0];
    }
    async remove(kind, company, record) {
        const rows = await this.request(TABLES[kind], {select: 'id', company_id: 'eq.' + company, id: 'eq.' + record.id, updated_at: 'eq.' + record.updated_at}, {method: 'DELETE', headers: {Prefer: 'return=representation'}});
        if (!rows?.length) throw new Error('This record changed or you do not have permission to delete it. Refresh the list.');
    }
}
