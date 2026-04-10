const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection');

const FaqTranslation = sequelize.define(
    'FaqTranslation',
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true
        },
        faq_id: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false
        },
        language: {
            type: DataTypes.STRING(5),
            allowNull: false
        },
        question: {
            type: DataTypes.TEXT,
            allowNull: false
        },
        answer: {
            type: DataTypes.TEXT,
            allowNull: false
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
        tableName: 'new_faq_translations',
        timestamps: false,
        underscored: true
    }
);

module.exports = FaqTranslation;
