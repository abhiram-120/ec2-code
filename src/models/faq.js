const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const Faq = sequelize.define(
    'Faq',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },
        is_active: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true
        },
        attachment_url: {
            type: DataTypes.STRING(1024),
            allowNull: true
        },
        attachment_mime_type: {
            type: DataTypes.STRING(128),
            allowNull: true
        },
        category: {
            type: DataTypes.STRING(64),
            allowNull: true
        },
        created_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        },
        updated_at: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        }
    },
    {
        tableName: 'new_faqs',
        timestamps: false,
        underscored: true
    }
);

module.exports = Faq;
