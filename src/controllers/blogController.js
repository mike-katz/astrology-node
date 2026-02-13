const db = require('../db');
require('dotenv').config();

function parseJsonSafe(val, fallback = null) {
    if (val == null) return fallback;
    if (typeof val === 'object') return val;
    if (typeof val !== 'string') return fallback;
    try {
        return JSON.parse(val);
    } catch {
        return fallback;
    }
}

async function getList(req, res) {
    try {
        let page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 20;
        const { category_id, title, category } = req.query;

        if (page < 1) page = 1;
        if (limit < 1) limit = 20;
        const offset = (page - 1) * limit;

        let query = db('blogs as b')
            .where(db.liveFilter('b.deleted_at'))
            .where({ is_publish: true });
        let countQuery = db('blogs as b')
            .leftJoin('blog_categories as c', 'c.id', 'b.blog_category_id')
            .where(db.liveFilter('b.deleted_at'))
            .where({ is_publish: true });

        if (category_id) {
            query = query.where('b.blog_category_id', category_id);
            countQuery = countQuery.where('b.blog_category_id', category_id);
        }
        if (category) {
            query = query.where('c.slug', category);
            countQuery = countQuery.where('c.slug', category);
        }

        // Filter by title if provided
        if (title && title.trim()) {
            query = query.where('b.title', 'ilike', `%${title.trim()}%`);
            countQuery = countQuery.where('b.title', 'ilike', `%${title.trim()}%`);
        }

        const blogs = await query
            .leftJoin('blog_categories as c', 'c.id', 'b.blog_category_id')
            .select('b.id', 'b.title', 'b.short_desc', 'b.image', 'b.created_at', 'b.hash_tag', 'b.meta_data', 'b.slug', 'b.is_publish', 'b.publish_date', 'c.slug as category_slug', 'c.name as category')
            .orderBy('b.id', 'desc')
            .limit(limit)
            .offset(offset);

        const [{ count }] = await countQuery.count('* as count');

        const total = parseInt(count);
        const totalPages = Math.ceil(total / limit);
        blogs.forEach(item => {
            item.hash_tag = parseJsonSafe(item?.hash_tag, []);
        });
        const response = {
            page,
            limit,
            total,
            totalPages,
            results: blogs
        };

        return res.status(200).json({
            success: true,
            data: response,
            message: 'Blog list fetched successfully'
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}

async function getDetail(req, res) {
    try {
        const { id, slug } = req.query;
        // if (!id) {
        //     return res.status(400).json({ success: false, data: null, message: 'Missing params' });
        // }
        let query = db('blogs as b')
            .where(db.liveFilter('b.deleted_at'));
        if (id) {
            query = query.where('b.id', Number(id));
        }
        if (slug) {
            query = query.where('b.slug', 'ilike', `%${slug.trim()}%`);
        }

        const blog = await query
            .leftJoin('blog_categories as c', 'c.id', 'b.blog_category_id')
            .select('b.*', 'c.name as category').first();
        if (!blog) {
            return res.status(400).json({ success: false, data: null, message: 'Blog not found' });
        }
        blog.hash_tag = JSON.parse(blog?.hash_tag)
        return res.status(200).json({
            success: true,
            data: blog,
            message: 'Blog detail fetched successfully'
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}


async function getCategory(req, res) {
    try {
        const categories = await db.live('blog_categories').orderBy('id', 'asc');
        return res.status(200).json({
            success: true,
            data: categories,
            message: 'List fetched successfully'
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
}
module.exports = { getList, getDetail, getCategory };
