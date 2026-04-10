// src/models/FamilyPastDuePayment.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const FamilyPastDuePayment = sequelize.define(
    'FamilyPastDuePayment',
    {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true
        },
        family_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            references: {
                model: 'families',
                key: 'id'
            },
            comment: 'Reference to the family that has the past due payment'
        },
        family_payment_transaction_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: {
                model: 'family_payment_transactions',
                key: 'id'
            },
            comment: 'Reference to the failed family payment transaction'
        },
        recurring_payment_uid: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'PayPlus recurring payment UID for this family'
        },
        amount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            comment: 'Total amount that failed for all children in the family'
        },
        currency: {
            type: DataTypes.STRING(10),
            defaultValue: 'ILS',
            comment: 'Currency code for the failed payment'
        },
        failed_at: {
            type: DataTypes.DATE,
            allowNull: false,
            comment: 'Timestamp when the payment failed'
        },
        due_date: {
            type: DataTypes.DATEONLY,
            allowNull: false,
            comment: 'Date when the payment was due'
        },
        grace_period_days: {
            type: DataTypes.INTEGER,
            defaultValue: 30,
            comment: 'Number of days in the grace period'
        },
        grace_period_expires_at: {
            type: DataTypes.DATE,
            allowNull: false,
            comment: 'Timestamp when the grace period expires'
        },
        status: {
            type: DataTypes.ENUM('past_due', 'resolved', 'canceled'),
            defaultValue: 'past_due',
            comment: 'Current status of the past due payment'
        },
        attempt_number: {
            type: DataTypes.INTEGER,
            defaultValue: 1,
            comment: 'Number of failed payment attempts for this past due record'
        },
        last_reminder_sent_at: {
            type: DataTypes.DATE,
            allowNull: true,
            comment: 'Timestamp when the last reminder was sent'
        },
        total_reminders_sent: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
            comment: 'Total number of reminders sent for this past due payment'
        },
        whatsapp_messages_sent: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
            comment: 'Count of WhatsApp messages sent for this payment recovery'
        },
        short_id: {
            type: DataTypes.STRING(16),
            allowNull: true,
            comment: 'Short identifier used in recovery URLs for this family past due payment'
        },
        payment_link: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Recovery payment link URL for the family'
        },
        payplus_page_request_uid: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'PayPlus page request UID for recovery payment'
        },
        resolved_at: {
            type: DataTypes.DATE,
            allowNull: true,
            comment: 'Timestamp when the past due payment was resolved'
        },
        resolved_transaction_id: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'Transaction ID of the successful payment that resolved this past due'
        },
        resolved_payment_method: {
            type: DataTypes.STRING(50),
            allowNull: true,
            comment: 'Payment method used for manual resolution (free_gift, bit, bank_transfer, cash, other)'
        },
        canceled_at: {
            type: DataTypes.DATE,
            allowNull: true,
            comment: 'Timestamp when the past due payment was canceled'
        },
        cancellation_reason_category: {
            type: DataTypes.STRING(100),
            allowNull: true,
            comment: 'Category of cancellation reason'
        },
        cancellation_reason: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Detailed cancellation reason text'
        },
        // Error tracking fields
        failure_status_code: {
            type: DataTypes.STRING(50),
            allowNull: true,
            comment: 'PayPlus status code for the failed payment'
        },
        failure_message_description: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'PayPlus message description for the failed payment'
        },
        // Family-specific fields
        children_count: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
            comment: 'Number of children affected by this past due payment'
        },
        student_ids: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'JSON array of student IDs affected by this past due payment'
        },
        subscription_ids: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'JSON array of subscription IDs affected by this past due payment'
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Additional notes about this past due payment'
        }
    },
    {
        tableName: 'family_past_due_payments',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        underscored: true,
        collate: 'utf8mb4_unicode_ci'
    }
);

module.exports = FamilyPastDuePayment;

