// SPDX-License-Identifier: Apache-2.0
//
// SQLite → PostgreSQL 数据迁移命令
//
// 用法:
//
//	go run cmd/migrate/main.go
//
// 前置条件:
//  1. PostgreSQL 已启动: cd docker && docker compose up -d postgres
//  2. SQLite 数据库文件 mygeektime.db 在项目根目录
//
// 环境变量:
//   PG_DSN: PostgreSQL 连接串 (默认: host=localhost user=postgres password=postgres
//           dbname=mygeektime port=5432 sslmode=disable TimeZone=Asia/Shanghai)
package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/zkep/my-geektime/internal/model"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const batchSize = 500

func main() {
	projectRoot := findProjectRoot()
	sqlitePath := filepath.Join(projectRoot, "mygeektime.db")

	pgDSN := os.Getenv("PG_DSN")
	if pgDSN == "" {
		pgDSN = "host=localhost user=postgres password=postgres dbname=mygeektime port=5432 sslmode=disable TimeZone=Asia/Shanghai"
	}

	fmt.Println("=== SQLite → PostgreSQL 数据迁移 ===")
	fmt.Printf("源 SQLite:  %s\n", sqlitePath)
	fmt.Printf("目标 PG:    %s\n", pgDSN)
	fmt.Println()

	// ---- 连接 SQLite ----
	src, err := gorm.Open(sqlite.Open(sqlitePath), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		log.Fatalf("连接 SQLite 失败: %v", err)
	}
	fmt.Println("[OK] 已连接 SQLite")

	var tables []string
	src.Raw("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").Scan(&tables)
	if len(tables) == 0 {
		log.Fatalln("SQLite 中未找到表，请确认 mygeektime.db 路径正确")
	}
	fmt.Printf("  表: %v\n\n", tables)

	// ---- 连接 PostgreSQL ----
	dst, err := gorm.Open(postgres.Open(pgDSN), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		log.Fatalf("连接 PostgreSQL 失败: %v", err)
	}
	fmt.Println("[OK] 已连接 PostgreSQL")

	// ---- AutoMigrate 建表 ----
	fmt.Println("\n=== 创建 PostgreSQL 表结构 ===")
	for _, m := range allModels() {
		if err := dst.AutoMigrate(m); err != nil {
			log.Fatalf("AutoMigrate %T 失败: %v", m, err)
		}
	}
	fmt.Println("[OK] 表结构创建完成")

	// ---- 清空目标表 ----
	fmt.Println("\n=== 清空目标表 ===")
	for _, t := range tableNames() {
		dst.Exec(fmt.Sprintf("TRUNCATE TABLE %s CASCADE", t))
	}
	fmt.Println("[OK] 全部清空")

	// ---- 迁移数据 ----
	fmt.Println("\n=== 迁移数据 ===")
	var totalMigrated int
	for _, mt := range migrateTasks() {
		n := mt.fn(src, dst)
		totalMigrated += n
	}

	// ---- 修正序列 ----
	fmt.Println("\n=== 修正自增序列 ===")
	for _, t := range tableNames() {
		var maxID int64
		dst.Table(t).Select("COALESCE(MAX(id), 0)").Scan(&maxID)
		if maxID > 0 {
			dst.Exec(fmt.Sprintf("ALTER SEQUENCE %s_id_seq RESTART WITH %d", t, maxID+1))
			fmt.Printf("  %-30s 序列 -> %d\n", t, maxID+1)
		}
	}

	// ---- 统计 ----
	fmt.Printf("\n=== 迁移完成 ===\n总计迁移 %d 条记录\n\n", totalMigrated)
	fmt.Println("各表行数:")
	for _, t := range tableNames() {
		var count int64
		dst.Table(t).Count(&count)
		fmt.Printf("  %-30s %d 行\n", t, count)
	}
}

// ---- 模型和表定义 ----

func allModels() []any {
	return []any{
		&model.User{},
		&model.Task{},
		&model.Article{},
		&model.ArticleSimple{},
		&model.Product{},
		&model.ArticleComment{},
		&model.ArticleCommentDiscussion{},
		&model.Collect{},
		&model.SysDict{},
	}
}

func tableNames() []string {
	return []string{
		"sys_dicts", "users", "articles", "article_simples", "products",
		"article_comments", "article_comment_discussions", "collects", "tasks",
	}
}

// ---- 迁移任务定义 ----

type migrateTask struct {
	name string
	fn   func(src, dst *gorm.DB) int
}

func migrateTasks() []migrateTask {
	return []migrateTask{
		{"sys_dicts", migrateTable[*model.SysDict]("sys_dicts")},
		{"users", migrateTable[*model.User]("users")},
		{"articles", migrateTable[*model.Article]("articles")},
		{"article_simples", migrateTable[*model.ArticleSimple]("article_simples")},
		{"products", migrateTable[*model.Product]("products")},
		{"article_comments", migrateTable[*model.ArticleComment]("article_comments")},
		{"article_comment_discussions", migrateTable[*model.ArticleCommentDiscussion]("article_comment_discussions")},
		{"collects", migrateTable[*model.Collect]("collects")},
		{"tasks", migrateTable[*model.Task]("tasks")},
	}
}

// migrateTable 返回一个闭包，从 SQLite 读取并写入 PostgreSQL
func migrateTable[T any](tableName string) func(src, dst *gorm.DB) int {
	return func(src, dst *gorm.DB) int {
		start := time.Now()

		var srcCount int64
		src.Table(tableName).Count(&srcCount)
		if srcCount == 0 {
			fmt.Printf("  %-30s 空表，跳过\n", tableName)
			return 0
		}

		migrated := 0
		offset := 0
		for {
			var batch []T
			if err := src.Table(tableName).
				Order("id ASC").
				Limit(batchSize).
				Offset(offset).
				Find(&batch).Error; err != nil {
				log.Fatalf("SQLite 读取 %s (offset=%d) 失败: %v", tableName, offset, err)
			}
			if len(batch) == 0 {
				break
			}

			if err := dst.Table(tableName).Create(batch).Error; err != nil {
				log.Fatalf("PostgreSQL 写入 %s 失败: %v", tableName, err)
			}

			migrated += len(batch)
			offset += len(batch)
			fmt.Printf("  %-30s %d/%d 行 (%d%%)\r",
				tableName, migrated, srcCount, migrated*100/int(srcCount))
		}

		elapsed := time.Since(start)
		fmt.Printf("  %-30s %d 行, 耗时 %v\n", tableName, migrated, elapsed.Round(time.Millisecond))
		return migrated
	}
}

// findProjectRoot 向上查找包含 go.mod 的目录
func findProjectRoot() string {
	dir, err := os.Getwd()
	if err != nil {
		log.Fatalf("获取当前目录失败: %v", err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			log.Fatalln("未找到 go.mod，请在项目目录下运行")
		}
		dir = parent
	}
}
