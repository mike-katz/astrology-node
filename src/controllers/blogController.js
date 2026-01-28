const db = require('../db');
require('dotenv').config();

async function getList(req, res) {
    try {
        let page = parseInt(req.query.page) || 1;
        let limit = parseInt(req.query.limit) || 20;
        const { category_id, title } = req.query;

        if (page < 1) page = 1;
        if (limit < 1) limit = 20;
        const offset = (page - 1) * limit;

        const filter = { 'b.deleted_at': null, is_publish: true };

        // Filter by category if provided
        if (category_id) {
            filter['b.blog_category_id'] = category_id;
        }

        let query = db('blogs as b')
            .where(filter);

        let countQuery = db('blogs as b')
            .where(filter);

        // Filter by title if provided
        if (title && title.trim()) {
            query = query.where('b.title', 'ilike', `%${title.trim()}%`);
            countQuery = countQuery.where('b.title', 'ilike', `%${title.trim()}%`);
        }

        const blogs = await query
            .orderBy('b.id', 'desc')
            .limit(limit)
            .offset(offset);

        const [{ count }] = await countQuery.count('* as count');

        const total = parseInt(count);
        const totalPages = Math.ceil(total / limit);
        blogs.map(item => {
            item.hash_tag = JSON.parse(item?.hash_tag)
        })
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
        const { id } = req.query;
        if (!id) {
            return res.status(400).json({ success: false, data: null, message: 'Missing params' });
        }
        const blog = await db('blogs as b')
            .leftJoin('blog_categories as c', 'c.id', 'b.blog_category_id')
            .select('b.*', 'c.name as category')
            .where({ 'b.id': id, 'b.deleted_at': null }).first();
        if (!blog) {
            return res.status(404).json({ success: false, data: null, message: 'Blog not found' });
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
        const categories = await db('blog_categories').whereNull('deleted_at');
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
