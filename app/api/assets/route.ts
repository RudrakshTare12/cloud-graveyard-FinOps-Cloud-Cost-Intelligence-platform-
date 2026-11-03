import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { uploadAuditLogToS3 } from '@/lib/s3';

// GET: Sabhi cloud assets fetch karne ke liye
export async function GET() {
    try {
        const [rows] = await pool.query('SELECT * FROM cloud_assets');
        return NextResponse.json(rows);
    } catch (error) {
        return NextResponse.json([]);
    }
}

// DELETE: Zombie Resource ko Purge (Delete) aur S3 log create karne ke liye
export async function DELETE(request: Request) {
    try {
        const { id, name } = await request.json();
        await pool.query('DELETE FROM cloud_assets WHERE id = ?', [id]);

        // AWS S3 Audit log trigger
        await uploadAuditLogToS3(name, 'PURGE_ZOMBIE_ASSET');

        return NextResponse.json({ success: true, message: `${name} has been purged to the graveyard!` });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to purge asset' }, { status: 500 });
    }
}