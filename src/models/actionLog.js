const { DataTypes } = require('sequelize');
const { sequelize } = require('../connection/connection'); // adjust path as needed

const ActionLog = sequelize.define(
  "ActionLog",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    actor_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    action_type: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },

    target_entity: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },

    target_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    old_value: {
      type: DataTypes.JSON,
      allowNull: true,
    },

    new_value: {
      type: DataTypes.JSON,
      allowNull: true,
    },

    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "action_logs",
    timestamps: false, // we are manually handling created_at
  }
);

module.exports= ActionLog;