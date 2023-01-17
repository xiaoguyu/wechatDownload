DROP TABLE IF EXISTS wx_article;
CREATE TABLE wx_article (
    id INT ( 11 ) NOT NULL AUTO_INCREMENT,
    title VARCHAR ( 255 ) NULL DEFAULT NULL COMMENT '标题',
    content LONGTEXT NULL COMMENT '内容',
    author VARCHAR ( 255 ) NULL DEFAULT NULL COMMENT '作者',
    content_url VARCHAR ( 1023 ) NULL DEFAULT NULL COMMENT '详情链接',
    create_time datetime ( 0 ) NULL DEFAULT NULL,
    copyright_stat INT ( 11 ) NULL DEFAULT NULL,
    PRIMARY KEY ( id ) USING BTREE,
    UNIQUE INDEX uni_title ( title, create_time ) USING BTREE 
) ;